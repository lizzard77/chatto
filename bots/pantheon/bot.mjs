/**
 * Pantheon – Würfel-Bot für Chatto (Daggerheart, Savage Worlds, freies Würfeln)
 * Hört über @chatto/client (Realtime) auf alle Nachrichten in Räumen, in denen der Bot
 * Mitglied ist, und antwortet über dessen Requests.
 */

import { createClient } from '@chatto/client';
import { MessageService, RoomService, ThreadService, UserService } from '@chatto/client/types';
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

const MAX_RETRY_MS = 30_000;

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
// Chatto-Verbindung
// ---------------------------------------------------------------------------

const client = createClient();
const server = client.connect({ serverUrl: chattoUrl, apiKey });
const messageService = server.service(MessageService);
const deleteMessage = (roomId, eventId) => messageService.deleteMessage({ roomId, eventId });

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
        const res = await server.service(UserService).getUser({ target: { case: 'userId', value: userId } });
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
        await deleteMessage(message.roomId, message.eventId);
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
    const post = (threadRootId, inReplyTo) => server.createMessage({ roomId: message.roomId, threadRootId }, body, { inReplyTo });
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
async function timelineMessages(request) {
    const messages = [];
    let before;
    for (;;) {
        const cursor = before ? { case: 'before', value: before } : undefined;
        const { page } = request.threadRootEventId
            ? await server.service(ThreadService).getThreadEvents({ ...request, limit: 500, cursor })
            : await server.service(RoomService).getRoomEvents({ ...request, limit: 500, cursor });
        for (const { event } of page?.events ?? []) {
            if (event.case === 'messagePosted' && event.value.message) messages.push(event.value.message);
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
 * stehen – auch die Kopfnachricht des Würfel-Threads (z. B. ein Kartenbild) und Zeichnungen –,
 * außer in Threads, deren Kopfnachricht gelöscht ist oder jetzt gelöscht wird: dort gehen alle
 * Antworten mit.
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

    const timeline = await timelineMessages({ roomId });
    for (const m of timeline) classify(m);
    const roots = new Set();
    for (const root of timeline) {
        if (root.id !== diceRoot && !root.thread?.replyCount) continue;
        const replies = (await timelineMessages({ roomId, threadRootEventId: root.id }))
            .filter(m => m.id !== root.id);
        // Ist die Kopfnachricht gelöscht (oder wird sie jetzt gelöscht), gehen alle Antworten mit
        const orphaned = root.deletedAt || doomed.has(root.id);
        for (const reply of replies) {
            if (orphaned && !reply.deletedAt) doomed.set(reply.id, 'orphan');
            else classify(reply);
        }
        if (doomed.has(root.id)) roots.add(root.id);
    }
    if (!doomed.has(message.eventId)) doomed.set(message.eventId, 'command');

    // Antworten vor den Kopfnachrichten löschen, sonst bleibt der Thread als Rest stehen
    const order = [...doomed.keys()].sort((a, b) => roots.has(a) - roots.has(b));
    const counts = { command: 0, bot: 0, orphan: 0 };
    let failed = 0;
    for (const eventId of order) {
        try {
            await deleteMessage(roomId, eventId);
            counts[doomed.get(eventId)]++;
        } catch (error) {
            failed++;
            if (failed === 1) console.warn(`⚠️  Purge in Raum ${roomId}: Löschen fehlgeschlagen (fehlt message.manage?):`, error.message);
        }
        await sleep(50);
    }
    console.log(`🧹 Purge in Raum ${roomId}: ${JSON.stringify(counts)}, ${failed} fehlgeschlagen`);

    const parts = [`${counts.command} Befehle`, `${counts.bot} Bot-Nachrichten`];
    if (counts.orphan) parts.push(`${counts.orphan} Antworten in gelöschten Threads`);
    const text = `🧹 Aufgeräumt: ${parts.join(', ')} gelöscht.`
        + (failed ? ` ${failed} Nachrichten ließen sich nicht löschen (fehlt \`message.manage\`?).` : '');
    const note = await server.createMessage({ roomId }, text);
    setTimeout(() => deleteMessage(roomId, note.id).catch(() => {}), 60_000);
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
            message = await server.getMessage({ roomId, messageId: messageEventId });
        } catch (error) {
            console.warn('Bearbeitete Nachricht nicht lesbar:', error.message);
            return;
        }
        if (!message) return;
        return runCommand({
            eventId: message.id,
            roomId,
            threadRootEventId: message.threadRootId,
            sender: message.authorId,
            body: message.body
        });
    }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function startBot() {
    for (let attempt = 1; ; attempt++) {
        try {
            ({ viewerId: botUserId } = await server.ready());
            break;
        } catch (error) {
            if (server.sessionEnded) throw new Error('Server lehnt den API-Key ab');
            console.error(`❌ Anmeldung fehlgeschlagen (Versuch ${attempt}):`, error.message);
            await sleep(Math.min(MAX_RETRY_MS, 2000 * attempt));
        }
    }

    console.log('🎲 Pantheon gestartet!');
    console.log(`   Bot User ID: ${botUserId}`);
    console.log(`   Chatto: ${chattoUrl}`);
    console.log(`   Command Prefix: ${prefix}`);
    console.log(`   3D-Würfel: ${dice3d ? 'an' : 'aus'}`);
    console.log(`   Befehle löschen: ${deleteCommands ? 'an' : 'aus'}`);
    console.log(`   Makros: ${Object.keys(macros).join(', ') || 'keine'}`);
    // Ereignisse kommen der Reihe nach; Reconnect und Resume erledigt der Client
    await server.consumeEvents({
        onEvent: (event) => handleEvent(event).catch(error => console.error('Realtime-Verarbeitung fehlgeschlagen:', error.message)),
        onStatus: (status) => {
            if (status.state === 'ready') console.log(`🔌 Realtime verbunden${status.gap ? ' (Ereignisse können fehlen)' : ''}`);
            else if (status.state === 'reconnecting') console.warn('⚠️  Realtime getrennt – verbinde neu');
        }
    });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log('\n🛑 Beende Bot...');
        client.close();
    });
}

startBot().catch((error) => {
    console.error('❌', error.message);
    process.exitCode = 1;
}).finally(() => client.close());
