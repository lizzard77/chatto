// Postet MSG_B64 (Base64, Markdown) als Pantheon-Bot in den Raum ROOM.
// Läuft im chatto-pantheon-Container (dort liegt CHATTO_API_KEY), aufgerufen von notify.sh.
const body = Buffer.from(process.env.MSG_B64 || '', 'base64').toString('utf8').trim();
if (!body || !process.env.ROOM) { console.error('MSG_B64/ROOM fehlt'); process.exit(2); }
const res = await fetch('http://chatto:4000/api/connect/chatto.api.v1.MessageService/CreateMessage', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.CHATTO_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ roomId: process.env.ROOM, body })
});
console.log(res.status === 200 ? 'notify ok' : `notify failed: ${res.status} ${await res.text()}`);
process.exit(res.status === 200 ? 0 : 1);
