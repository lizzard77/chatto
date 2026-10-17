/**
 * Fensterfreigabe für Erato: liefert ein Fenster (oder einen Bildschirm) als rohe
 * I420-Frames fester Größe auf stdout eines Kindprozesses.
 *
 * - Linux/Wayland (KDE, GNOME …): ScreenCast-Portal + GStreamer (share-portal.mjs)
 * - Linux/X11: ffmpeg x11grab, Fenster per Klick (xwininfo) oder Fenster-ID
 * - Windows: ffmpeg gdigrab, Fenster per Titel
 * - macOS: ffmpeg avfoundation, nur ganzer Bildschirm
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startPortalCapture } from './share-portal.mjs';


export function captureBackend() {
    if (process.platform === 'win32') return 'gdigrab';
    if (process.platform === 'darwin') return 'avfoundation';
    return process.env.WAYLAND_DISPLAY ? 'portal' : 'x11';
}

// Fenster per Mausklick wählen (X11)
async function pickX11Window() {
    console.log('🖱️  Fenster anklicken, das geteilt werden soll...');
    const { stdout } = await promisify(execFile)('xwininfo', []);
    const id = stdout.match(/Window id: (0x[0-9a-f]+)/i)?.[1];
    if (!id) throw new Error('xwininfo lieferte keine Fenster-ID');
    return id;
}

function ffmpegCapture(input, { width, height, fps }) {
    const filter = [
        `fps=${fps}`,
        `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        'format=yuv420p'
    ].join(',');
    return spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        ...input,
        '-vf', filter,
        '-f', 'rawvideo', '-'
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Startet die Erfassung. `target` hängt vom Backend ab: Wayland: ohne (Dialog),
 * X11: Fenster-ID (sonst Klick), Windows: Fenstertitel (sonst ganzer Desktop),
 * macOS: avfoundation-Gerät.
 */
export async function startVideoCapture({ width, height, fps, target }) {
    switch (captureBackend()) {
        case 'portal':
            return startPortalCapture({ width, height, fps });
        case 'x11':
            return ffmpegCapture([
                '-f', 'x11grab', '-framerate', String(fps), '-draw_mouse', '1',
                '-window_id', target || await pickX11Window(),
                '-i', process.env.DISPLAY || ':0'
            ], { width, height, fps });
        case 'gdigrab':
            return ffmpegCapture([
                '-f', 'gdigrab', '-framerate', String(fps),
                '-i', target ? `title=${target}` : 'desktop'
            ], { width, height, fps });
        case 'avfoundation':
            return ffmpegCapture([
                '-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', '1',
                '-i', `${target || 'Capture screen 0'}:none`
            ], { width, height, fps });
    }
}

/** Liest ganze I420-Frames aus dem stdout der Erfassung. */
export async function* readFrames(capture, width, height) {
    const frameBytes = width * height * 3 / 2;
    let pending = Buffer.alloc(0);
    for await (const chunk of capture.stdout) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= frameBytes) {
            // Kopie, damit der Frame nicht auf den Stream-Puffer zeigt
            yield new Uint8Array(pending.subarray(0, frameBytes));
            pending = pending.subarray(frameBytes);
        }
    }
}
