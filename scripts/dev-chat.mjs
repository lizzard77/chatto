#!/usr/bin/env node
// Als Testuser auf dem Dev-Server schreiben und lesen (zum Testen der Bots), ohne Abhängigkeiten.
//   scripts/dev-chat.mjs post <raum> <text> [<thread-id>]   gibt die ID der Nachricht aus
//   scripts/dev-chat.mjs edit <raum> <id> <text>
//   scripts/dev-chat.mjs list <raum> [<anzahl>] [<thread-id>]
//   scripts/dev-chat.mjs dm <login>                          DM mit <login> öffnen, gibt die Raum-ID aus
// <raum>: ID oder Name (z. B. general). Benutzer: AS=bob (Standard alice), Port: CHATTO_DEV_PORT.
const url = `http://localhost:${process.env.CHATTO_DEV_PORT || 4400}`;
const login = process.env.AS || 'alice';

const { token } = await (await fetch(`${url}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: 'foobar123' })
})).json();

async function rpc(method, body) {
    const res = await fetch(`${url}/api/connect/chatto.api.v1.${method}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${text}`);
    return JSON.parse(text || '{}');
}

async function roomId(nameOrId) {
    const { rooms = [] } = await rpc('RoomDirectoryService/ListRooms', {});
    return rooms.find(r => r.room.name === nameOrId)?.room.id ?? nameOrId;
}

const [cmd, target, ...rest] = process.argv.slice(2);
switch (cmd) {
    case 'post': {
        const { message } = await rpc('MessageService/CreateMessage',
            { roomId: await roomId(target), body: rest[0], threadRootEventId: rest[1] });
        console.log(message.id);
        break;
    }
    case 'edit':
        await rpc('MessageService/UpdateMessage',
            { roomId: await roomId(target), eventId: rest[0], body: rest[1], updateMask: 'body' });
        break;
    case 'list': {
        const room = await roomId(target);
        const limit = Number(rest[0] || 10);
        const { page } = rest[1]
            ? await rpc('ThreadService/GetThreadEvents', { roomId: room, threadRootEventId: rest[1], limit })
            : await rpc('RoomService/GetRoomEvents', { roomId: room, limit });
        const users = page.includes?.users ?? {};
        for (const event of page.events ?? []) {
            const m = event.messagePosted?.message;
            if (!m) continue;
            const who = users[m.actorId]?.login ?? m.actorId;
            const flags = [m.deletedAt && 'gelöscht', m.threadRootEventId && `Thread ${m.threadRootEventId}`,
                m.thread?.replyCount && `${m.thread.replyCount} Antworten`].filter(Boolean).join(', ');
            console.log(`${m.id} ${who}${flags ? ` [${flags}]` : ''}: ${(m.body ?? '').replace(/\n/g, ' ⏎ ')}`);
        }
        break;
    }
    case 'dm': {
        const { user } = await rpc('UserService/GetUser', { login: target });
        const { room } = await rpc('RoomService/StartDM', { participantIds: [user.user.id] });
        console.log(room.id);
        break;
    }
    default:
        console.error('Befehle: post, edit, list, dm (siehe Kopf der Datei)');
        process.exit(2);
}
