/**
 * Pantheon – Daggerheart Dice Bot für Chatto
 * Hört per Realtime-WebSocket auf alle Nachrichten in Räumen, in denen der Bot
 * Mitglied ist, und antwortet über die ConnectRPC-API (JSON).
 */

import { createRequire } from 'node:module';
import {
    RealtimeServerFrame,
    RealtimeSubscribe,
    RealtimeInitialState
} from './gen/chatto/realtime/v1/realtime_pb.js';

const require = createRequire(import.meta.url);
const helpCommand = require('./commands/help');
const rollCommand = require('./commands/roll');
const inventoryCommand = require('./commands/inventory');
const characterCommand = require('./commands/character');
const { getUserMode, setUserMode } = require('./utils/storage');

// Konfiguration
const chattoUrl = (process.env.CHATTO_URL || 'http://chatto:4000').replace(/\/$/, '');
const apiKey = process.env.CHATTO_API_KEY;
const commandPrefix = process.env.COMMAND_PREFIX || '!';
// 3D-Würfel im Chatto-Fork (Patch 0002): Würfel als Marker-Link an die Antwort hängen
const dice3d = process.env.DICE_3D !== 'false';

const PROTOCOL_VERSION = 4;
const HEARTBEAT_STALL_MS = 75_000;
const MAX_RECONNECT_MS = 30_000;

let defaultMacros = {};
try {
    defaultMacros = JSON.parse(process.env.DEFAULT_MACROS || '{}');
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
// Ausgabe: Die Commands liefern (plain, html) im Matrix-Stil. Chatto speichert
// Nachrichten als Markdown, also wird das HTML in Markdown übersetzt.
// ---------------------------------------------------------------------------

function htmlToMarkdown(html) {
    return html
        .replace(/\r?\n/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?font[^>]*>/gi, '')
        .replace(/<\/?(b|strong)>/gi, '**')
        .replace(/<\/?(i|em)>/gi, '_')
        .replace(/<\/?code>/gi, '`')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        // Bot-Antworten sollen niemanden anpingen
        .replace(/@/g, '\\@')
        .trim();
}

// Gepatchte Clients rollen die Würfel in 3D und zeigen 🎲 als Replay-Button,
// andere sehen einen harmlosen 🎲-Link. Format: ../fork/README.md (Würfel-Marker).
// `;by=` nennt den Würfelnden (Autor der Nachricht ist ja der Bot), für „nur meine Würfe“.
function diceMarker(dice, rollerId) {
    const entries = (dice || [])
        .filter(d => d.value >= 1 && d.value <= d.sides)
        .slice(0, 24)
        .map(d => `${d.kind}.${d.sides}.${d.value}`);
    if (!entries.length) return '';
    const by = /^[\w-]{1,64}$/.test(rollerId || '') ? `;by=${rollerId}` : '';
    return ` [🎲](#chatto-dice:${entries.join(',')}${by})`;
}

function makeSender(message) {
    return async function sendHtmlMessage(roomId, plain, html, dice) {
        let body = html ? htmlToMarkdown(html) : plain;
        if (dice3d) body += diceMarker(dice, message.sender);
        await rpc('chatto.api.v1.MessageService', 'CreateMessage', {
            roomId,
            body,
            threadRootEventId: message.threadRootEventId || undefined,
            inReplyTo: message.eventId
        });
    };
}

// ---------------------------------------------------------------------------
// Command-Dispatch
// ---------------------------------------------------------------------------

let botUserId = null;

async function handleCommand(message) {
    const { roomId, sender, body } = message;
    const args = body.trim().split(/\s+/);
    const command = args[0].toLowerCase();
    const commandArgs = args.slice(1);
    const send = makeSender(message);

    if (command === `${commandPrefix}help` || command === `${commandPrefix}hilfe`) {
        await helpCommand.execute(null, roomId, send);
        return;
    }

    if (command === `${commandPrefix}roll` || command === `${commandPrefix}r`) {
        await rollCommand.execute(null, roomId, commandArgs, sender, send, defaultMacros);
        return;
    }

    if (command === `${commandPrefix}inventory` || command === `${commandPrefix}inv`) {
        await inventoryCommand.execute(null, roomId, commandArgs, sender, send);
        return;
    }

    if (command === `${commandPrefix}char` || command === `${commandPrefix}character`) {
        // "@name" im Text → User-ID aus den Mentions der Nachricht
        const resolveUser = () => message.mentionedUserIds[0] || null;
        await characterCommand.execute(null, roomId, commandArgs, sender, send, resolveUser);
        return;
    }

    if (command === `${commandPrefix}gm`) {
        await setUserMode(sender, 'gm');
        await send(roomId,
            `👹 GM-Mode aktiviert — !roll würfelt jetzt 1d20 (GM's Die).`,
            `👹 <b>GM-Mode aktiviert</b> — <code>!roll</code> würfelt jetzt <b>1d20</b> (GM's Die). Zurück mit <code>!player</code>.`);
        return;
    }

    if (command === `${commandPrefix}player`) {
        await setUserMode(sender, 'player');
        await send(roomId,
            `🗡️ Player-Mode aktiviert — !roll würfelt jetzt Duality Dice (2d12 Hope+Fear).`,
            `🗡️ <b>Player-Mode aktiviert</b> — <code>!roll</code> würfelt jetzt <b>Duality Dice</b> (2d12 Hope+Fear).`);
        return;
    }

    if (command === `${commandPrefix}mode`) {
        const isGm = (await getUserMode(sender)) === 'gm';
        await send(roomId,
            isGm ? `👹 Aktueller Mode: GM (1d20)` : `🗡️ Aktueller Mode: Player (2d12 Hope+Fear)`,
            isGm ? `👹 Aktueller Mode: <b>GM</b> (1d20)` : `🗡️ Aktueller Mode: <b>Player</b> (2d12 Hope+Fear)`);
        return;
    }

    // Unbekannter Command – Hilfe anzeigen
    if (command.startsWith(commandPrefix) && command.length > commandPrefix.length) {
        await helpCommand.execute(null, roomId, send);
    }
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
    if (!body.trimStart().startsWith(commandPrefix)) return;

    const mentionedUserIds = posted.mentions
        .filter(m => m.cause.case === 'direct' && m.cause.value.userId !== botUserId)
        .map(m => m.cause.value.userId);

    try {
        await handleCommand({
            eventId: event.id,
            roomId: posted.roomId,
            threadRootEventId: posted.threadRootEventId,
            sender,
            body: body.trim(),
            mentionedUserIds
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
    console.log(`   Command Prefix: ${commandPrefix}`);
    console.log(`   3D-Würfel: ${dice3d ? 'an' : 'aus'}`);
    console.log(`   Standard Macros: ${Object.keys(defaultMacros).join(', ') || 'keine'}`);
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
