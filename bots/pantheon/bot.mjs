/**
 * Pantheon – Würfel-Bot für Chatto (Daggerheart, Savage Worlds, freies Würfeln)
 * Hört per Realtime-WebSocket auf alle Nachrichten in Räumen, in denen der Bot
 * Mitglied ist, und antwortet über die ConnectRPC-API (JSON).
 */

import {
    RealtimeServerFrame,
    RealtimeSubscribe,
    RealtimeInitialState
} from './gen/chatto/realtime/v1/realtime_pb.js';
import { SYSTEMS, helpText, modeText, roll } from './rolls.mjs';
import { dealRound, parseNames } from './initiative.mjs';
import {
    isGm, roomDiceThread, roomInitiative, roomSystem,
    setGm, setRoomDiceThread, setRoomInitiative, setRoomSystem
} from './storage.mjs';

// Konfiguration
const chattoUrl = (process.env.CHATTO_URL || 'http://chatto:4000').replace(/\/$/, '');
const apiKey = process.env.CHATTO_API_KEY;
const prefix = process.env.COMMAND_PREFIX || '!';
// 3D-Würfel im Chatto-Fork (Patch 0002): Würfel als Marker-Link an die Antwort hängen
const dice3d = process.env.DICE_3D !== 'false';
// Befehlsnachricht (`!r 2d6`) nach der Antwort löschen, damit der Kanal nicht vollläuft.
// Die Antwort nennt dann den Würfelnden. Braucht `message.manage` im Raum.
const deleteCommands = process.env.DELETE_COMMANDS !== 'false';

const PROTOCOL_VERSION = 4;
const HEARTBEAT_STALL_MS = 75_000;
const MAX_RECONNECT_MS = 30_000;

let macros = {};
try {
    macros = JSON.parse(process.env.DEFAULT_MACROS || '{}');
} catch (e) {
    console.warn('Warnung: DEFAULT_MACROS konnte nicht geparst werden:', e.message);
}

if (!apiKey) {
    console.error('Fehler: CHATTO_API_KEY nicht gesetzt!');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// ConnectRPC (JSON)
// ---------------------------------------------------------------------------

async function rpc(service, method, body = {}) {
    const res = await fetch(`${chattoUrl}/api/connect/${service}/${method}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1'
        },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`${service}/${method} → HTTP ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

// Gepatchte Clients rollen die Würfel in 3D und zeigen 🎲 als Replay-Button,
// andere sehen einen harmlosen 🎲-Link. Format: README des Forks (Würfel-Marker).
// `;by=` nennt den Würfelnden (Autor der Nachricht ist ja der Bot), für „nur meine Würfe“;
// `;sw=` ist das Ergebnis eines Savage-Worlds-Eigenschaftswurfs für das Banner;
// `;gm=1` markiert Würfe im GM-Modus (die Würfel-Leiste zeigt GMs den letzten Wurf pro Spieler);
// `;sys=` nennt das System des Raums (die Würfel-Leiste zeigt den Dualitätswurf nur bei `dh`).
function diceMarker(dice, rollerId, swade, gm, system) {
    const entries = (dice || [])
        .filter(d => d.value >= 1 && d.value <= d.sides)
        .slice(0, 24)
        .map(d => `${d.kind}.${d.sides}.${d.value}`);
    if (!entries.length) return '';
    const by = /^[\w-]{1,64}$/.test(rollerId || '') ? `;by=${rollerId}` : '';
    const sw = swade === undefined ? ''
        : `;sw=${typeof swade === 'number' ? (swade > 0 ? `r${Math.min(swade, 9)}` : 'ok') : swade}`;
    return ` [🎲](#chatto-dice:${entries.join(',')}${by}${sw}${gm ? ';gm=1' : ''}${sysParam(system)})`;
}

const sysParam = (system) => /^\w{1,16}$/.test(system || '') ? `;sys=${system}` : '';

// Unsichtbarer Marker mit dem System des Raums, für Antworten auf `!system`
function systemMarker(system) {
    return /^\w{1,16}$/.test(system || '') ? ` [\u200b](#chatto-dice-system:${system})` : '';
}

// Anzeigenamen der Würfelnden, 10 Minuten zwischengespeichert
const NAME_TTL_MS = 10 * 60_000;
const names = new Map();
async function displayName(userId) {
    const cached = names.get(userId);
    if (cached && Date.now() - cached.at < NAME_TTL_MS) return cached.name;
    let name = null;
    try {
        const res = await rpc('chatto.api.v1.UserService', 'GetUser', { userId });
        name = res.user?.user?.displayName || res.user?.user?.login || null;
    } catch (error) {
        console.warn('Anzeigename nicht lesbar:', error.message);
    }
    names.set(userId, { name, at: Date.now() });
    return name;
}

const escapeMarkdown = (text) => text.replace(/[\\`*_~[\]()#>|]/g, '\\$&');

// Räume, in denen das Löschen schon gescheitert ist (Warnung nur einmal)
const deleteDenied = new Set();
async function deleteCommand(message) {
    try {
        await rpc('chatto.api.v1.MessageService', 'DeleteMessage', {
            roomId: message.roomId,
            eventId: message.eventId
        });
    } catch (error) {
        if (deleteDenied.has(message.roomId)) return;
        deleteDenied.add(message.roomId);
        console.warn(`⚠️  Befehl in Raum ${message.roomId} nicht gelöscht (fehlt message.manage?):`, error.message);
    }
}

/**
 * Antwort auf einen Befehl. `thread` leitet die Antwort in einen anderen Thread um
 * (Würfel-Sammelthread); `gm` markiert den Wurf als GM-Wurf.
 */
// Würfel-Antworten ohne Würfel (Fehler, Hinweise) bekommen einen unsichtbaren Marker
// (Linktext ist ein Nullbreite-Leerzeichen): die Würfel-Leiste des Forks zeigt sie dem Würfelnden.
function noteMarker(rollerId, system) {
    return /^[\w-]{1,64}$/.test(rollerId || '') ? ` [\u200b](#chatto-dice-note:by=${rollerId}${sysParam(system)})` : '';
}

async function reply(message, { text, dice, swade }, { thread = null, gm = false, note = false, system = null } = {}) {
    const elsewhere = thread && thread !== message.threadRootEventId;
    // Wird der Befehl gelöscht oder umgeleitet, nennt die Antwort den Würfelnden
    const name = deleteCommands || elsewhere ? await displayName(message.sender) : null;
    // Bot-Antworten sollen niemanden anpingen
    let body = (name ? `**${escapeMarkdown(name)}** ` : '') + text.replace(/@/g, '\\@');
    if (dice3d) body += diceMarker(dice, message.sender, swade, gm, system);
    if (note && !dice?.length) body += noteMarker(message.sender, system);
    const post = (threadRootEventId, inReplyTo) => rpc('chatto.api.v1.MessageService', 'CreateMessage', {
        roomId: message.roomId, body, threadRootEventId, inReplyTo
    });
    const inReplyTo = deleteCommands || elsewhere ? undefined : message.eventId;
    if (elsewhere) {
        try {
            await post(thread, undefined);
        } catch (error) {
            // Sammelthread weg (gelöscht?) – vergessen und normal antworten
            console.warn(`⚠️  Würfel-Thread ${thread} nicht erreichbar, antworte im Raum:`, error.message);
            await setRoomDiceThread(message.roomId, null);
            await post(message.threadRootEventId || undefined, inReplyTo);
        }
    } else {
        await post(message.threadRootEventId || undefined, inReplyTo);
    }
    if (deleteCommands) await deleteCommand(message);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

let botUserId = null;

async function handleCommand(message) {
    const { roomId, sender, body } = message;
    const [first, ...args] = body.trim().split(/\s+/);
    const command = first.slice(prefix.length).toLowerCase();
    const system = roomSystem(roomId);
    const gm = isGm(sender);
    const send = (text) => reply(message, { text });

    switch (command) {
        case 'roll':
        case 'r':
            return reply(message, roll(args, { system, gm, macros }), { thread: roomDiceThread(roomId), gm, note: true, system });

        case 'dice':
        case 'würfel':
            return diceThread(message, args, send);

        case 'ini':
        case 'init':
            if (system !== 'swade') return send('🃏 `!ini` gibt es nur für Savage Worlds (`!system swade`).');
            return initiative(roomId, args, send);

        case 'system': {
            const wanted = args[0]?.toLowerCase();
            if (!wanted) return send(`System in diesem Raum: **${SYSTEMS[system]}**. Umschalten mit \`!system dh\`, \`!system swade\` oder \`!system raw\`.${systemMarker(system)}`);
            if (!SYSTEMS[wanted]) return send(`❌ Unbekanntes System \`${args[0]}\` — \`dh\` (Daggerheart), \`swade\` (Savage Worlds) oder \`raw\` (freies Würfeln)`);
            await setRoomSystem(roomId, wanted);
            return send(`🎲 System in diesem Raum: **${SYSTEMS[wanted]}**\n${modeText(wanted, gm)}${systemMarker(wanted)}`);
        }

        case 'gm':
        case 'dm':
            await setGm(sender, true);
            return send(`**GM-Modus aktiviert.** ${modeText(system, true)} — zurück mit \`!player\``);

        case 'player':
            await setGm(sender, false);
            return send(`**Spieler-Modus aktiviert.** ${modeText(system, false)}`);

        case 'mode':
            return send(`${SYSTEMS[system]} · ${modeText(system, gm)}`);

        case 'purge':
            return purge(message);

        case 'help':
        case 'hilfe':
            return send(helpText(system));

        default:
            // Unbekannter Command – Hilfe anzeigen
            if (command) return send(helpText(system));
    }
}

// Würfel-Sammelthread: `!dice` in einem Thread macht ihn zum Ziel aller Würfe des Raums
async function diceThread(message, args, send) {
    const sub = args[0]?.toLowerCase();
    if (sub === 'aus' || sub === 'off') {
        await setRoomDiceThread(message.roomId, null);
        return send('🎲 Würfel-Thread beendet – Würfe landen wieder direkt im Raum.');
    }
    if (!message.threadRootEventId) {
        const current = roomDiceThread(message.roomId);
        return send(current
            ? '🎲 Für diesen Raum ist ein Würfel-Thread aktiv. Neue Session: Thread starten und dort `!dice` schreiben; beenden mit `!dice aus`.'
            : '🎲 Starte einen Thread (z. B. „Würfe – Session 12“) und schreib dort `!dice`. Ab dann landen alle Würfe des Raums in diesem Thread.');
    }
    await setRoomDiceThread(message.roomId, message.threadRootEventId);
    return send('🎲 **Würfel-Thread für diese Session.** Alle Würfe aus dem Raum landen ab jetzt hier; beenden mit `!dice aus`.');
}

// ---------------------------------------------------------------------------
// Aufräumen nach der Session (`!purge`)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Alle Nachrichten einer Zeitleiste (Raum oder Thread) über alle Seiten, auch gelöschte
async function timelineMessages(method, request) {
    const messages = [];
    let before;
    for (;;) {
        const service = method === 'GetThreadEvents' ? 'ThreadService' : 'RoomService';
        const { page } = await rpc(`chatto.api.v1.${service}`, method, { ...request, limit: 500, ...(before ? { before } : {}) });
        for (const event of page?.events ?? []) {
            const message = event.messagePosted?.message;
            if (message) messages.push(message);
        }
        if (!page?.hasOlder || !page.startCursor) break;
        before = page.startCursor;
    }
    return messages;
}

const isCommand = (message) => message.actorId !== botUserId && message.body?.trimStart().startsWith(prefix);

/**
 * Räumt den Raum nach der Session auf: löscht alle `!…`-Nachrichten (gültig oder nicht) und
 * alle Nachrichten des Bots, im Raum und in allen Threads. Was Menschen schreiben, bleibt
 * stehen – auch die Kopfnachricht des Würfel-Threads (z. B. ein Kartenbild) und Zeichnungen.
 * Die Bestätigung verschwindet nach einer Minute wieder.
 */
async function purge(message) {
    const { roomId } = message;
    const diceRoot = roomDiceThread(roomId);
    // ID → Grund
    const doomed = new Map();
    const classify = (m) => {
        if (m.deletedAt || doomed.has(m.id)) return;
        if (isCommand(m)) doomed.set(m.id, 'command');
        else if (m.actorId === botUserId) doomed.set(m.id, 'bot');
    };

    const timeline = await timelineMessages('GetRoomEvents', { roomId });
    for (const m of timeline) classify(m);
    const roots = new Set();
    for (const root of timeline) {
        if (root.id !== diceRoot && !root.thread?.replyCount) continue;
        const replies = (await timelineMessages('GetThreadEvents', { roomId, threadRootEventId: root.id }))
            .filter(m => m.id !== root.id);
        for (const reply of replies) classify(reply);
        if (doomed.has(root.id)) roots.add(root.id);
    }
    if (!doomed.has(message.eventId)) doomed.set(message.eventId, 'command');

    // Antworten vor den Kopfnachrichten löschen, sonst bleibt der Thread als Rest stehen
    const order = [...doomed.keys()].sort((a, b) => roots.has(a) - roots.has(b));
    const counts = { command: 0, bot: 0 };
    let failed = 0;
    for (const eventId of order) {
        try {
            await rpc('chatto.api.v1.MessageService', 'DeleteMessage', { roomId, eventId });
            counts[doomed.get(eventId)]++;
        } catch (error) {
            failed++;
            if (failed === 1) console.warn(`⚠️  Purge in Raum ${roomId}: Löschen fehlgeschlagen (fehlt message.manage?):`, error.message);
        }
        await sleep(50);
    }
    console.log(`🧹 Purge in Raum ${roomId}: ${JSON.stringify(counts)}, ${failed} fehlgeschlagen`);

    const parts = [`${counts.command} Befehle`, `${counts.bot} Bot-Nachrichten`];
    const text = `🧹 Aufgeräumt: ${parts.join(', ')} gelöscht.`
        + (failed ? ` ${failed} Nachrichten ließen sich nicht löschen (fehlt \`message.manage\`?).` : '');
    const { message: note } = await rpc('chatto.api.v1.MessageService', 'CreateMessage', { roomId, body: text });
    if (note?.id) setTimeout(() => {
        rpc('chatto.api.v1.MessageService', 'DeleteMessage', { roomId, eventId: note.id }).catch(() => {});
    }, 60_000);
}

// Savage-Worlds-Initiative (Aktionsdeck pro Raum)
async function initiative(roomId, args, send) {
    const current = roomInitiative(roomId);
    const sub = args[0]?.toLowerCase();

    if (sub === 'neu' || sub === 'new' || sub === 'mischen') {
        await setRoomInitiative(roomId, { names: current?.names ?? [], deck: [], reshuffle: true });
        return send('🔀 Aktionsdeck wird vor der nächsten Runde neu gemischt.');
    }

    // `+Name` / `-Name`: Teilnehmerliste ändern, ohne zu ziehen
    if (args.length && /^[+-]/.test(args[0])) {
        let names = current?.names ?? [];
        let sign = '+';
        // `+Ork -Mira`, `+Ork, Troll` oder `+Großer Ork` (mit Komma) – Vorzeichen gilt bis zum nächsten
        for (const part of args.join(' ').split(/\s*,\s*|\s+(?=[+-])/)) {
            if (/^[+-]/.test(part)) sign = part[0];
            const name = part.replace(/^[+-]/, '').trim();
            if (!name) continue;
            names = names.filter(n => n.toLowerCase() !== name.toLowerCase());
            if (sign === '+') names.push(name);
        }
        await setRoomInitiative(roomId, { ...current, names });
        return send(names.length
            ? `🃏 Teilnehmer: ${names.join(', ')} — nächste Runde mit \`!ini\``
            : '🃏 Keine Teilnehmer mehr. Neu starten mit `!ini Name1 Name2 …`');
    }

    const names = args.length ? parseNames(args) : current?.names ?? [];
    if (!names.length) return send('🃏 Wer ist dabei? `!ini Ragnar Mira Goblins` (Namen mit Leerzeichen per Komma trennen)');
    const { text, state } = dealRound(current, names);
    await setRoomInitiative(roomId, state);
    return send(text);
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

const seenEventIds = new Set();
function markSeen(id) {
    seenEventIds.add(id);
    if (seenEventIds.size > 2000) {
        seenEventIds.delete(seenEventIds.values().next().value);
    }
}

let resumeCursor;
let reconnectAttempt = 0;
let stopped = false;
let processing = Promise.resolve();

// Befehle, die schon ausgeführt wurden (auch nach mehrfachem Bearbeiten nur einmal)
const handledCommands = new Set();

async function runCommand(message) {
    if (!message.sender || message.sender === botUserId || !message.body) return;
    if (!message.body.trimStart().startsWith(prefix)) return;
    if (handledCommands.has(message.eventId)) return;
    handledCommands.add(message.eventId);
    if (handledCommands.size > 2000) handledCommands.delete(handledCommands.values().next().value);
    try {
        await handleCommand({ ...message, body: message.body.trim() });
    } catch (error) {
        console.error(`❌ Fehler bei "${message.body.trim()}":`, error.message);
    }
}

async function handleEvent(event) {
    if (seenEventIds.has(event.id)) return;
    markSeen(event.id);

    if (event.event.case === 'messagePosted') {
        const posted = event.event.value;
        if (posted.echoOfEventId) return;
        return runCommand({
            eventId: event.id,
            roomId: posted.roomId,
            threadRootEventId: posted.threadRootEventId,
            sender: event.actorId,
            body: posted.bodyPlaintext
        });
    }

    // Erst nachträglich zum Befehl gemacht (`roll 2d6` → `!roll 2d6`): neuen Text holen
    if (event.event.case === 'messageEdited') {
        const { roomId, messageEventId } = event.event.value;
        if (handledCommands.has(messageEventId)) return;
        let message;
        try {
            ({ message } = await rpc('chatto.api.v1.MessageService', 'GetMessage', { roomId, eventId: messageEventId }));
        } catch (error) {
            console.warn('Bearbeitete Nachricht nicht lesbar:', error.message);
            return;
        }
        if (!message || message.deletedAt) return;
        return runCommand({
            eventId: message.id,
            roomId,
            threadRootEventId: message.threadRootEventId,
            sender: message.actorId,
            body: message.body
        });
    }
}

function scheduleReconnect(delayMs) {
    if (stopped) return;
    const backoff = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** reconnectAttempt++);
    setTimeout(connect, Math.max(delayMs || 0, backoff));
}

function connect() {
    if (stopped) return;
    const wsUrl = chattoUrl.replace(/^http/, 'ws') + '/api/realtime';
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    let lastFrameAt = Date.now();
    let closed = false;
    let retryAfterMs = 0;

    const watchdog = setInterval(() => {
        if (Date.now() - lastFrameAt >= HEARTBEAT_STALL_MS) {
            console.warn('⚠️  Kein Heartbeat – verbinde neu');
            socket.close();
        }
    }, 5_000);

    socket.addEventListener('open', () => {
        const subscribe = new RealtimeSubscribe({
            protocolVersion: PROTOCOL_VERSION,
            bearerToken: apiKey,
            initialState: RealtimeInitialState.LIVE_ONLY,
            resumeCursor
        });
        socket.send(subscribe.toBinary());
    });

    socket.addEventListener('message', (msg) => {
        lastFrameAt = Date.now();
        let frame;
        try {
            frame = RealtimeServerFrame.fromBinary(new Uint8Array(msg.data));
        } catch (error) {
            console.error('Realtime-Frame nicht lesbar:', error.message);
            socket.close();
            return;
        }

        processing = processing.then(async () => {
            switch (frame.frame.case) {
                case 'event':
                    await handleEvent(frame.frame.value);
                    if (frame.frame.value.cursor) resumeCursor = frame.frame.value.cursor;
                    break;
                case 'heartbeat':
                    if (frame.frame.value.cursor) resumeCursor = frame.frame.value.cursor;
                    break;
                case 'caughtUp':
                    resumeCursor = frame.frame.value.cursor;
                    reconnectAttempt = 0;
                    console.log('🔌 Realtime verbunden');
                    break;
                case 'close': {
                    const close = frame.frame.value;
                    console.warn(`Realtime geschlossen: ${close.message} (code ${close.code})`);
                    if (!close.reconnect) {
                        console.error('❌ Server verweigert Reconnect – API-Key prüfen. Beende in 60s.');
                        stopped = true;
                        setTimeout(() => process.exit(1), 60_000);
                    }
                    if (close.retryAfter) {
                        retryAfterMs = Number(close.retryAfter.seconds) * 1000 + close.retryAfter.nanos / 1e6;
                    }
                    socket.close();
                    break;
                }
            }
        }).catch(error => console.error('Realtime-Verarbeitung fehlgeschlagen:', error.message));
    });

    const onClose = () => {
        if (closed) return;
        closed = true;
        clearInterval(watchdog);
        scheduleReconnect(retryAfterMs);
    };
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', (e) => {
        console.warn('Realtime-Fehler:', e.message || e.type);
        onClose();
    });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function startBot() {
    for (let attempt = 1; ; attempt++) {
        try {
            const viewer = await rpc('chatto.api.v1.ViewerService', 'GetViewer');
            botUserId = viewer.user?.profile?.id;
            if (!botUserId) throw new Error('Viewer-Antwort ohne user.profile.id');
            break;
        } catch (error) {
            console.error(`❌ Anmeldung fehlgeschlagen (Versuch ${attempt}):`, error.message);
            await new Promise(r => setTimeout(r, Math.min(MAX_RECONNECT_MS, 2000 * attempt)));
        }
    }

    console.log('🎲 Pantheon gestartet!');
    console.log(`   Bot User ID: ${botUserId}`);
    console.log(`   Chatto: ${chattoUrl}`);
    console.log(`   Command Prefix: ${prefix}`);
    console.log(`   3D-Würfel: ${dice3d ? 'an' : 'aus'}`);
    console.log(`   Befehle löschen: ${deleteCommands ? 'an' : 'aus'}`);
    console.log(`   Makros: ${Object.keys(macros).join(', ') || 'keine'}`);
    connect();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log('\n🛑 Beende Bot...');
        stopped = true;
        process.exit(0);
    });
}

startBot();
