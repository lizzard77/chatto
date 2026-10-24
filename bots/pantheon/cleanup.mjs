/**
 * Einmaliges Aufräumen alter Würfe: löscht `!…`-Befehle, die Pantheon beantwortet hat, und
 * schreibt den Namen des Würfelnden vor die alte Antwort – so sehen alte Würfe aus wie neue.
 *
 * Standard ist ein Probelauf, der nur zählt. Erst `APPLY=1` ändert Nachrichten.
 *   node cleanup.mjs                     Probelauf über alle Räume des Bots
 *   ROOM=<roomId> node cleanup.mjs       nur ein Raum
 *   APPLY=1 node cleanup.mjs             wirklich löschen und bearbeiten
 * Im Container: docker exec -i -e APPLY=1 chatto-pantheon node --input-type=module - < cleanup.mjs
 *
 * Nur die Hauptzeitleiste der Räume; Befehle in Threads bleiben stehen.
 */

import { createApi } from '@chatto/client';
import { MessageService, RoomDirectoryService, RoomService } from '@chatto/client/types';

const chattoUrl = (process.env.CHATTO_URL || 'http://chatto:4000').replace(/\/$/, '');
const apiKey = process.env.CHATTO_API_KEY;
const prefix = process.env.COMMAND_PREFIX || '!';
const apply = process.env.APPLY === '1';
const onlyRoom = process.env.ROOM || null;

if (!apiKey) {
    console.error('Fehler: CHATTO_API_KEY nicht gesetzt!');
    process.exit(1);
}

const api = createApi({ serverUrl: chattoUrl, apiKey });
const messageService = api.service(MessageService);

const escapeMarkdown = (text) => text.replace(/[\\`*_~[\]()#>|]/g, '\\$&');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function memberRooms() {
    const rooms = [];
    for (let offset = 0; ; offset += 100) {
        const res = await api.service(RoomDirectoryService).listRooms({ page: { limit: 100, offset } });
        for (const entry of res.rooms) {
            if (!entry.viewerState?.isMember) continue;
            const granted = new Set(entry.viewerState.permissions.filter(p => p.granted).map(p => p.permission));
            rooms.push({ id: entry.room.id, name: entry.room.name, canManage: granted.has('message.manage') });
        }
        if (!res.page?.hasMore) break;
    }
    return rooms;
}

// Alle Nachrichten der Hauptzeitleiste, älteste zuerst, und die Nutzerprofile dazu
async function roomMessages(roomId) {
    const messages = [];
    const users = {};
    let before;
    for (;;) {
        const { page } = await api.service(RoomService).getRoomEvents({
            roomId, limit: 500, cursor: before ? { case: 'before', value: before } : undefined
        });
        Object.assign(users, page?.includes?.users ?? {});
        for (const { event } of page?.events ?? []) {
            if (event.case === 'messagePosted' && event.value.message) messages.push(event.value.message);
        }
        if (!page?.hasOlder || !page.startCursor) break;
        before = page.startCursor;
    }
    messages.sort((a, b) => a.createdAt.toDate() - b.createdAt.toDate());
    return { messages, users };
}

const { viewerId: botId } = await api.ready();

console.log(apply ? '⚠️  APPLY: Nachrichten werden gelöscht und bearbeitet' : '🔍 Probelauf – es wird nichts geändert');
let totalDeleted = 0;
let totalEdited = 0;

for (const room of await memberRooms()) {
    if (onlyRoom && room.id !== onlyRoom) continue;
    const { messages, users } = await roomMessages(room.id);
    const byId = new Map(messages.map(m => [m.id, m]));

    // Paare: Befehl eines Menschen + Antwort des Bots darauf
    const pairs = [];
    for (const reply of messages) {
        if (reply.actorId !== botId || !reply.inReplyTo) continue;
        const command = byId.get(reply.inReplyTo);
        if (!command || command.actorId === botId) continue;
        if (!command.body?.trimStart().startsWith(prefix)) continue;
        pairs.push({ command, reply });
    }
    const commandIds = new Set(pairs.map(p => p.command.id));
    console.log(`\n# ${room.name} (${room.id})${room.canManage ? '' : ' – ⚠️ Bot hat hier kein message.manage'}`);
    console.log(`  ${pairs.length} beantwortete Befehle, ${commandIds.size} davon zu löschen`);
    if (!pairs.length) continue;
    if (apply && !room.canManage) {
        console.log('  übersprungen: ohne message.manage kann der Bot keine Befehle löschen');
        continue;
    }

    const samples = pairs.slice(-2);
    for (const { command, reply } of samples) {
        const name = users[command.actorId]?.displayName || users[command.actorId]?.login || '?';
        console.log(`  z. B. „${command.body.trim().slice(0, 40)}“ → „**${name}** ${reply.body.slice(0, 50).replace(/\n/g, ' ')}…“`);
    }
    if (!apply) continue;

    for (const { command, reply } of pairs) {
        const user = users[command.actorId];
        const name = user?.displayName || user?.login;
        const tag = name ? `**${escapeMarkdown(name)}** ` : '';
        // Mehrfach ausgeführt bleibt das Ergebnis gleich
        if (tag && !reply.body.startsWith(tag)) {
            await messageService.updateMessage({
                roomId: room.id, eventId: reply.id, body: tag + reply.body, updateMask: { paths: ['body'] }
            });
            totalEdited++;
            await sleep(50);
        }
    }
    for (const id of commandIds) {
        await messageService.deleteMessage({ roomId: room.id, eventId: id });
        totalDeleted++;
        await sleep(50);
    }
    console.log(`  erledigt`);
}

if (apply) console.log(`\n✅ ${totalDeleted} Befehle gelöscht, ${totalEdited} Antworten mit Namen versehen`);
