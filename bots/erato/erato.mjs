/**
 * Erato – Musik-Bot für Chatto
 * Tritt dem Anruf eines Raums bei (startet ihn notfalls) und streamt eine lokale
 * Audioquelle hinein. Läuft lokal, nicht auf he1: Standardmäßig legt Erato ein
 * virtuelles Ausgabegerät "Erato" an; was dort abgespielt wird, hören alle im Call.
 *
 *   node erato.mjs [<room-id>] [<audiodatei>]
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
    AudioFrame,
    AudioSource,
    LocalAudioTrack,
    Room,
    RoomEvent,
    TrackPublishOptions,
    TrackSource,
    dispose
} from '@livekit/rtc-node';

// .env neben dem Skript laden, unabhängig vom Arbeitsverzeichnis und von --env-file.
// Variablen aus der Shell haben Vorrang.
const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Konfiguration
const chattoUrl = (process.env.CHATTO_URL || 'https://chat.he1.lizzard77.dev').replace(/\/$/, '');
const apiKey = process.env.CHATTO_API_KEY;
const roomId = process.argv[2] || process.env.CHATTO_ROOM_ID;
const inputFile = process.argv[3] || process.env.ERATO_FILE;
const bitrate = Number(process.env.ERATO_BITRATE || 128_000);
// Lokal mithören (Loopback auf die normale Ausgabe), nur mit ERATO_MONITOR=1
const monitor = process.env.ERATO_MONITOR === '1';
// Weitere Aufnahmequellen (PipeWire/Pulse-Namen, kommagetrennt), die direkt in den
// Stream gemischt werden, z. B. ein RØDECaster-Ausgang mit den Soundpads
const extraSources = (process.env.ERATO_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);

const SINK_NAME = 'erato';
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SAMPLES = SAMPLE_RATE / 100; // 10 ms
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

if (!apiKey || !roomId) {
    console.error('Aufruf: CHATTO_API_KEY=… node erato.mjs <room-id> [<audiodatei>]');
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

function pactl(...args) {
    return execFileSync('pactl', args, { encoding: 'utf8' }).trim();
}

function setupVirtualSink() {
    pulseModules.push(pactl('load-module', 'module-null-sink',
        `sink_name=${SINK_NAME}`, 'sink_properties=device.description=Erato'));
    // Mithören: das virtuelle Gerät zusätzlich auf die normale Ausgabe legen
    if (monitor) pulseModules.push(pactl('load-module', 'module-loopback',
        `source=${SINK_NAME}.monitor`, 'latency_msec=50'));
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
            : ['-f', 'pulse', '-i', `${SINK_NAME}.monitor`],
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
    console.log(`   Raum: ${roomId}`);
    console.log(inputFile
        ? `   Quelle: ${inputFile} (Endlosschleife)`
        : `   Quelle: Ausgabegerät "Erato" – Musikplayer dorthin routen (Mithören ${monitor ? 'an' : 'aus'})`);
    for (const name of extraSources) console.log(`   + ${name}`);

    await pump(ffmpeg, source);
}

main().catch((error) => {
    console.error('❌', error.message);
    shutdown(1);
});
