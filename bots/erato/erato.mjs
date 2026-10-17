/**
 * Erato – Musik-Bot für Chatto
 * Tritt dem Anruf eines Raums bei (startet ihn notfalls) und streamt eine lokale
 * Audioquelle hinein. Läuft lokal, nicht auf he1: Standardmäßig legt Erato ein
 * virtuelles Ausgabegerät "Erato" an; was dort abgespielt wird, hören alle im Call.
 *
 * Zusätzlich kann Erato ein Fenster vom Desktop als Kamerabild senden (share.mjs),
 * gesteuert über die Konsole oder aus einem anderen Terminal:
 *
 * Pro PC und Channel läuft höchstens ein Erato (Steuer-Socket je Channel als Sperre).
 *
 *   node erato.mjs [<channel-id|name>] [<audiodatei>]   (ohne Channel: Auswahl beim Start)
 *   node erato.mjs ctl [-c <channel>] share [<ziel>] | stop | status | quit
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import {
    AudioFrame,
    AudioSource,
    LocalAudioTrack,
    LocalVideoTrack,
    Room,
    RoomEvent,
    TrackPublishOptions,
    TrackSource,
    VideoBufferType,
    VideoFrame,
    VideoSource,
    dispose
} from '@livekit/rtc-node';
import { DegradationPreference, VideoCodec } from '@livekit/rtc-ffi-bindings';
import { captureBackend, readFrames, startVideoCapture } from './share.mjs';

// Steuer-Socket je Channel; zugleich die Sperre "ein Erato pro PC und Channel"
const controlDir = process.platform === 'win32'
    ? '\\\\.\\pipe\\'
    : (process.env.XDG_RUNTIME_DIR || tmpdir());
const controlPath = (id) => join(controlDir, `erato-${id}.sock`);

function sendControl(path, command) {
    return new Promise((resolve, reject) => {
        let reply = '';
        const socket = net.connect(path, () => socket.end(command + '\n'));
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => { reply += chunk; });
        socket.on('error', reject);
        socket.on('close', () => resolve(reply));
    });
}

// "node erato.mjs ctl [-c <channel>] …" schickt einen Befehl an ein laufendes Erato
async function control(args) {
    let channel;
    if (args[0] === '-c') [, channel, ...args] = args;
    channel = channel?.replace(/^#/, '');
    const sockets = [];
    for (const file of readdirSync(controlDir)) {
        const id = file.match(/^erato-(.+)\.sock$/)?.[1];
        if (!id) continue;
        const name = await sendControl(controlPath(id), 'name').catch(() => null);
        if (name !== null) sockets.push({ id, name: name.trim() });
    }
    const matches = channel
        ? sockets.filter(s => s.id === channel || s.name.toLowerCase() === channel.toLowerCase())
        : sockets;
    if (matches.length !== 1) {
        console.error(matches.length ? 'Mehrere Erato laufen, Channel mit -c angeben:' : 'Kein passendes Erato läuft.');
        for (const s of sockets) console.error(`  ${s.id}  #${s.name}`);
        return 1;
    }
    process.stdout.write(await sendControl(controlPath(matches[0].id), args.join(' ') || 'status'));
    return 0;
}

if (process.argv[2] === 'ctl') process.exit(await control(process.argv.slice(3)));

// .env neben dem Skript laden, unabhängig vom Arbeitsverzeichnis und von --env-file.
// Variablen aus der Shell haben Vorrang.
const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Konfiguration
const chattoUrl = (process.env.CHATTO_URL || 'https://chat.he1.lizzard77.dev').replace(/\/$/, '');
const apiKey = process.env.CHATTO_API_KEY;
// Channel: Kommandozeile (ID oder Name), sonst Auswahl beim Start mit CHATTO_ROOM_ID als Vorschlag
const roomArg = process.argv[2];
let roomId;
let roomName;
const inputFile = process.argv[3] || process.env.ERATO_FILE;
const bitrate = Number(process.env.ERATO_BITRATE || 128_000);
// Lokal mithören (Loopback auf die normale Ausgabe), nur mit ERATO_MONITOR=1
const monitor = process.env.ERATO_MONITOR === '1';
// Weitere Aufnahmequellen (PipeWire/Pulse-Namen, kommagetrennt), die direkt in den
// Stream gemischt werden, z. B. ein RØDECaster-Ausgang mit den Soundpads
const extraSources = (process.env.ERATO_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
// Fensterfreigabe: Größe des gesendeten Bildes (Fenster wird eingepasst), Bildrate, Bitrate
const [videoWidth, videoHeight] = (process.env.ERATO_VIDEO_SIZE || '1920x1080').split('x').map(Number);
const videoFps = Number(process.env.ERATO_VIDEO_FPS || 15);
const videoBitrate = Number(process.env.ERATO_VIDEO_BITRATE || 4_000_000);
const videoCodec = VideoCodec[(process.env.ERATO_VIDEO_CODEC || 'vp8').toUpperCase()];
// Als Bildschirmfreigabe zeigt Chatto das Bild eingepasst (schwarze Balken), Kamerabilder
// werden in der großen Ansicht auf die Kachel zugeschnitten
const videoAsCamera = process.env.ERATO_VIDEO_AS === 'camera';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SAMPLES = SAMPLE_RATE / 100; // 10 ms
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

if (!apiKey) {
    console.error('Aufruf: CHATTO_API_KEY=… node erato.mjs [<channel>] [<audiodatei>]');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// ConnectRPC (JSON)
// ---------------------------------------------------------------------------

async function rpc(service, method, body = {}) {
    const res = await fetch(`${chattoUrl}/api/connect/chatto.api.v1.${service}/${method}`, {
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
        const err = new Error(`${service}/${method} → HTTP ${res.status}: ${text}`);
        try { err.code = JSON.parse(text).code; } catch { }
        throw err;
    }
    return text ? JSON.parse(text) : {};
}

// Nach JoinCall ist der Call nicht sofort aktiv, daher ein paar Versuche
async function createCallToken() {
    for (let attempt = 1; ; attempt++) {
        try {
            return await rpc('VoiceCallService', 'CreateCallToken', { roomId });
        } catch (error) {
            if (error.code !== 'failed_precondition' || attempt >= 10) throw error;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

// ---------------------------------------------------------------------------
// Audioquelle: virtuelles Ausgabegerät (PipeWire/Pulse) oder Datei
// ---------------------------------------------------------------------------

const pulseModules = [];
// Ein Gerät je Channel, damit mehrere Erato auf einem PC nebeneinander laufen können
let sinkName;

function pactl(...args) {
    return execFileSync('pactl', args, { encoding: 'utf8' }).trim();
}

function setupVirtualSink() {
    pulseModules.push(pactl('load-module', 'module-null-sink',
        `sink_name=${sinkName}`, `sink_properties='device.description="Erato (#${roomName.replace(/['"]/g, '')})"'`));
    // Mithören: das virtuelle Gerät zusätzlich auf die normale Ausgabe legen
    if (monitor) pulseModules.push(pactl('load-module', 'module-loopback',
        `source=${sinkName}.monitor`, 'latency_msec=50'));
}

function teardownVirtualSink() {
    while (pulseModules.length) {
        try { pactl('unload-module', pulseModules.pop()); } catch { }
    }
}

// Zusatzquellen werden erst in ffmpeg gemischt, nicht über das Erato-Gerät –
// sonst hörte man sie über den Mithör-Loopback doppelt
function startCapture() {
    const inputs = [
        inputFile
            ? ['-re', '-stream_loop', '-1', '-i', inputFile]
            : ['-f', 'pulse', '-i', `${sinkName}.monitor`],
        ...extraSources.map(name => ['-f', 'pulse', '-i', name])
    ];
    const mix = inputs.length > 1
        ? ['-filter_complex', `amix=inputs=${inputs.length}:normalize=0:dropout_transition=0`]
        : [];
    return spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        ...inputs.flat(),
        ...mix,
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-'
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
}

async function pump(ffmpeg, source) {
    let pending = Buffer.alloc(0);
    for await (const chunk of ffmpeg.stdout) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= FRAME_BYTES) {
            const bytes = pending.subarray(0, FRAME_BYTES);
            pending = pending.subarray(FRAME_BYTES);
            // Kopie, damit das Int16Array aligned ist und nicht auf den Stream-Puffer zeigt
            const samples = new Int16Array(FRAME_SAMPLES * CHANNELS);
            Buffer.from(samples.buffer).set(bytes);
            await source.captureFrame(new AudioFrame(samples, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES));
        }
    }
}

// ---------------------------------------------------------------------------
// Fensterfreigabe: wird als Kamera-Track gesendet, sobald der erste Frame da ist
// ---------------------------------------------------------------------------

let share = null; // { capture, publication }

async function startShare(target) {
    if (share) return 'Es wird schon geteilt – erst "stop".';
    const current = share = { capture: null, publication: null };
    try {
        current.capture = await startVideoCapture({ width: videoWidth, height: videoHeight, fps: videoFps, target });
    } catch (error) {
        if (share === current) share = null;
        return `Freigabe fehlgeschlagen: ${error.message}`;
    }
    // Während der Auswahl (X11-Klick) gestoppt
    if (share !== current) {
        current.capture.kill();
        return 'Freigabe abgebrochen.';
    }
    current.capture.on('error', (error) => console.error(`Freigabe: ${error.message}`));
    runShare(current).catch((error) => console.error(`❌ Freigabe: ${error.message}`))
        .finally(() => stopShare(current));
    return captureBackend() === 'portal'
        ? 'Fenster im Desktop-Dialog auswählen…'
        : 'Freigabe startet…';
}

async function runShare(current) {
    const source = new VideoSource(videoWidth, videoHeight);
    for await (const data of readFrames(current.capture, videoWidth, videoHeight)) {
        if (share !== current) break;
        if (!current.publication) {
            const track = LocalVideoTrack.createVideoTrack('Erato', source);
            current.publication = await room.localParticipant.publishTrack(track, new TrackPublishOptions({
                source: videoAsCamera ? TrackSource.SOURCE_CAMERA : TrackSource.SOURCE_SCREENSHARE,
                // Karte statt Gesicht: eine volle Stufe statt Simulcast, und bei Engpässen
                // lieber Bildrate als Auflösung opfern (Standard für Kameras wäre umgekehrt)
                simulcast: false,
                degradationPreference: DegradationPreference.MAINTAIN_RESOLUTION,
                videoCodec,
                videoEncoding: { maxBitrate: BigInt(videoBitrate), maxFramerate: videoFps }
            }));
            // Während des Veröffentlichens gestoppt: stopShare kannte den Track noch nicht
            if (share !== current) {
                await room.localParticipant.unpublishTrack(current.publication.sid).catch(() => { });
                break;
            }
            console.log(`📺 Teile Fenster (${videoWidth}×${videoHeight}, ${videoFps} fps)`);
        }
        current.lastFrame = data;
        source.captureFrame(new VideoFrame(data, videoWidth, videoHeight, VideoBufferType.I420));
    }
}

async function stopShare(current = share) {
    if (!current || share !== current) return 'Es wird nichts geteilt.';
    share = null;
    current.capture?.kill();
    if (current.publication) {
        await room?.localParticipant.unpublishTrack(current.publication.sid).catch(() => { });
        console.log('📺 Freigabe beendet');
    }
    return 'Freigabe beendet.';
}

// Zuletzt gesendetes Bild als PNG speichern (zum Prüfen, was im Call ankommt)
function snapshot(file) {
    const frame = share?.lastFrame;
    if (!frame) return 'Es wird nichts geteilt.';
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${videoWidth}x${videoHeight}`, '-i', '-',
        '-frames:v', '1', file], { input: frame });
    return `Gespeichert: ${file}`;
}

// ---------------------------------------------------------------------------
// Steuerung: Konsole und Steuer-Socket
// ---------------------------------------------------------------------------

const HELP = 'Befehle: share [<ziel>], stop, status, snapshot [<datei.png>], quit';

async function handleCommand(line) {
    const [command, ...rest] = line.trim().split(/\s+/);
    switch (command) {
        case 'share': return startShare(rest.join(' ') || undefined);
        case 'stop': return stopShare();
        case 'name': return roomName;
        case 'snapshot': return snapshot(rest.join(' ') || join(tmpdir(), 'erato-snapshot.png'));
        case 'status':
            return `#${roomName}: ` + (share?.publication ? 'Fenster wird geteilt.'
                : share ? 'Freigabe startet…' : 'es wird nichts geteilt.');
        case 'quit':
            setImmediate(() => shutdown(0));
            return 'Erato beendet sich.';
        case '': case undefined: return '';
        default: return HELP;
    }
}

let controlServer;

// Belegt den Steuer-Socket des Channels; schlägt fehl, wenn hier schon ein Erato läuft
function acquireControl(retry = true) {
    const path = controlPath(roomId);
    return new Promise((resolve, reject) => {
        const server = net.createServer({ allowHalfOpen: true }, (socket) => {
            socket.setEncoding('utf8');
            let input = '';
            socket.on('data', (chunk) => { input += chunk; });
            socket.on('end', async () => {
                const reply = await handleCommand(input).catch((error) => `Fehler: ${error.message}`);
                socket.end(reply ? reply + '\n' : '');
            });
            socket.on('error', () => { });
        });
        server.once('error', (error) => {
            if (error.code !== 'EADDRINUSE' || !retry) return reject(error);
            // Antwortet niemand, ist der Socket ein Überbleibsel
            sendControl(path, 'name').then(
                () => reject(new Error(`Auf diesem PC läuft schon ein Erato in #${roomName}`)),
                () => {
                    rmSync(path, { force: true });
                    acquireControl(false).then(resolve, reject);
                });
        });
        server.listen(path, () => {
            controlServer = server;
            resolve();
        });
    });
}

function startConsole() {
    if (!process.stdin.isTTY) return;
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', async (line) => {
        const reply = await handleCommand(line);
        if (reply) console.log(reply);
    });
    // readline fängt Ctrl+C selbst ab
    rl.on('SIGINT', () => shutdown(0));
    rl.on('close', () => shutdown(0));
}

// ---------------------------------------------------------------------------
// Channel-Auswahl
// ---------------------------------------------------------------------------

async function listCallRooms() {
    const rooms = [];
    for (let offset = 0; ; offset += 100) {
        const res = await rpc('RoomDirectoryService', 'ListRooms', {
            scope: 'ROOM_DIRECTORY_SCOPE_CHANNELS',
            page: { limit: 100, offset }
        });
        rooms.push(...(res.rooms || []));
        if (!res.page?.hasMore) break;
    }
    const granted = (r, permission) => r.viewerState?.permissions?.some(p => p.permission === permission && p.granted);
    return rooms
        .filter(r => granted(r, 'call.join'))
        .map(r => ({ id: r.room.id, name: r.room.name, member: !!r.viewerState?.isMember }));
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.on('SIGINT', () => process.exit(130));
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function chooseRoom() {
    const rooms = await listCallRooms();
    if (roomArg) {
        const wanted = roomArg.replace(/^#/, '').toLowerCase();
        const room = rooms.find(r => r.id === roomArg || r.name.toLowerCase() === wanted);
        if (!room) throw new Error(`Channel "${roomArg}" nicht gefunden oder Erato darf dort keinem Call beitreten`);
        return room;
    }
    if (!rooms.length) throw new Error('Erato darf in keinem Channel Calls beitreten (call.join)');
    const preset = rooms.findIndex(r => r.id === process.env.CHATTO_ROOM_ID);
    if (!process.stdin.isTTY) {
        if (preset < 0) throw new Error('Kein Channel angegeben (Argument oder CHATTO_ROOM_ID)');
        return rooms[preset];
    }
    console.log('In welchem Channel soll Erato aktiv werden?');
    rooms.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}) #${r.name}${r.member ? '' : '  (noch nicht beigetreten)'}`));
    for (; ;) {
        const answer = await ask(preset >= 0 ? `Nummer [${preset + 1}]: ` : 'Nummer: ');
        const index = answer ? Number(answer) - 1 : preset;
        if (rooms[index]) return rooms[index];
    }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

let room;
let ffmpeg;
let joined = false;
let shuttingDown = false;

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Beende Erato...');
    ffmpeg?.kill();
    share?.capture?.kill();
    controlServer?.close();
    teardownVirtualSink();
    await room?.disconnect().catch(() => { });
    if (joined) await rpc('VoiceCallService', 'LeaveCall', { roomId }).catch(() => { });
    await dispose();
    process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(0));
}

async function main() {
    const viewer = await rpc('ViewerService', 'GetViewer');
    const channel = await chooseRoom();
    ({ id: roomId, name: roomName } = channel);
    sinkName = `erato-${roomId}`;
    await acquireControl();
    if (!channel.member) await rpc('RoomService', 'JoinRoom', { roomId });
    const { runtime } = await rpc('ServerService', 'GetRuntimeConfig');
    const livekitUrl = process.env.LIVEKIT_URL || runtime?.livekitUrl;
    if (!livekitUrl) throw new Error('Chatto liefert keine LiveKit-URL – Calls nicht konfiguriert?');

    const join = await rpc('VoiceCallService', 'JoinCall', { roomId });
    if (!join.joined) throw new Error('JoinCall abgelehnt');
    joined = true;
    const { token, e2eeKey } = await createCallToken();

    room = new Room();
    room.on(RoomEvent.Disconnected, (reason) => {
        console.warn(`Call getrennt (${reason})`);
        shutdown(1);
    });
    // Gleicher Shared Key wie im Web-Client (ExternalE2EEKeyProvider.setKey)
    await room.connect(livekitUrl, token, {
        autoSubscribe: false,
        dynacast: false,
        encryption: { keyProviderOptions: { sharedKey: new TextEncoder().encode(e2eeKey) } }
    });

    const source = new AudioSource(SAMPLE_RATE, CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('Erato', source);
    await room.localParticipant.publishTrack(track, new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: false,
        red: false,
        audioEncoding: { maxBitrate: BigInt(bitrate) }
    }));

    if (!inputFile) setupVirtualSink();
    ffmpeg = startCapture();
    ffmpeg.on('exit', (code) => {
        if (!shuttingDown) {
            console.error(`ffmpeg beendet (code ${code})`);
            shutdown(1);
        }
    });

    console.log('🎵 Erato ist im Call!');
    console.log(`   Bot: ${viewer.user?.profile?.login || viewer.user?.profile?.id}`);
    console.log(`   Channel: #${roomName} (${roomId})`);
    console.log(inputFile
        ? `   Quelle: ${inputFile} (Endlosschleife)`
        : `   Quelle: Ausgabegerät "Erato (#${roomName})" – Musikplayer dorthin routen (Mithören ${monitor ? 'an' : 'aus'})`);
    for (const name of extraSources) console.log(`   + ${name}`);
    console.log(`   ${HELP}`);

    startConsole();

    await pump(ffmpeg, source);
}

main().catch((error) => {
    console.error('❌', error.message);
    shutdown(1);
});
