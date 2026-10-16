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
import { isGm, roomInitiative, roomSystem, setGm, setRoomInitiative, setRoomSystem } from './storage.mjs';

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
// `;sw=` ist das Ergebnis eines Savage-Worlds-Eigenschaftswurfs für das Banner.
function diceMarker(dice, rollerId, swade) {
    const entries = (dice || [])
        .filter(d => d.value >= 1 && d.value <= d.sides)
        .slice(0, 24)
        .map(d => `${d.kind}.${d.sides}.${d.value}`);
    if (!entries.length) return '';
    const by = /^[\w-]{1,64}$/.test(rollerId || '') ? `;by=${rollerId}` : '';
    const sw = swade === undefined ? ''
        : `;sw=${typeof swade === 'number' ? (swade > 0 ? `r${Math.min(swade, 9)}` : 'ok') : swade}`;
    return ` [🎲](#chatto-dice:${entries.join(',')}${by}${sw})`;
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

async function reply(message, { text, dice, swade }) {
    // Wird der Befehl gelöscht, nennt die Antwort den Würfelnden statt auf den Befehl zu antworten
    const name = deleteCommands ? await displayName(message.sender) : null;
    // Bot-Antworten sollen niemanden anpingen
    let body = (name ? `**${escapeMarkdown(name)}** ` : '') + text.replace(/@/g, '\\@');
    if (dice3d) body += diceMarker(dice, message.sender, swade);
    await rpc('chatto.api.v1.MessageService', 'CreateMessage', {
        roomId: message.roomId,
        body,
        threadRootEventId: message.threadRootEventId || undefined,
        inReplyTo: deleteCommands ? undefined : message.eventId
    });
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
            return reply(message, roll(args, { system, gm, macros }));

        case 'ini':
        case 'init':
            if (system !== 'swade') return send('🃏 `!ini` gibt es nur für Savage Worlds (`!system swade`).');
            return initiative(roomId, args, send);

        case 'system': {
            const wanted = args[0]?.toLowerCase();
            if (!wanted) return send(`System in diesem Raum: **${SYSTEMS[system]}**. Umschalten mit \`!system dh\`, \`!system swade\` oder \`!system raw\`.`);
            if (!SYSTEMS[wanted]) return send(`❌ Unbekanntes System \`${args[0]}\` — \`dh\` (Daggerheart), \`swade\` (Savage Worlds) oder \`raw\` (freies Würfeln)`);
            await setRoomSystem(roomId, wanted);
            return send(`🎲 System in diesem Raum: **${SYSTEMS[wanted]}**\n${modeText(wanted, gm)}`);
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

        case 'help':
        case 'hilfe':
            return send(helpText(system));

        default:
            // Unbekannter Command – Hilfe anzeigen
            if (command) return send(helpText(system));
    }
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

async function handleEvent(event) {
    if (event.event.case !== 'messagePosted') return;
    if (seenEventIds.has(event.id)) return;
    markSeen(event.id);

    const posted = event.event.value;
    const sender = event.actorId;
    const body = posted.bodyPlaintext;
    if (!sender || sender === botUserId || !body) return;
    if (posted.echoOfEventId) return;
    if (!body.trimStart().startsWith(prefix)) return;

    try {
        await handleCommand({
            eventId: event.id,
            roomId: posted.roomId,
            threadRootEventId: posted.threadRootEventId,
            sender,
            body: body.trim()
        });
    } catch (error) {
        console.error(`❌ Fehler bei "${body.trim()}":`, error.message);
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
