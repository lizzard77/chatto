/**
 * Fenster-/Bildschirmfreigabe über das ScreenCast-Portal (Wayland, z. B. KDE Plasma),
 * ohne Python: D-Bus per dbus-next, Bild per gst-launch-1.0 (pipewiresrc).
 *
 * Das Portal zeigt den Auswahldialog und legt einen PipeWire-Stream an. Den Datei-
 * deskriptor aus OpenPipeWireRemote braucht es nicht: Der Stream ist für normale
 * PipeWire-Clients sichtbar, gst-launch verbindet sich über seine object.serial.
 *
 * Ausgabe: rohe I420-Frames fester Größe, das Fenster eingepasst mit schwarzen Rändern.
 * Größe und Ränder rechnet Node selbst aus, weil pipewiresrc ein unsinniges Pixel-
 * Seitenverhältnis meldet (1/2147483647) und videoscale damit verzerren würde. Ändert
 * sich die Fenstergröße (pw-dump, jede Sekunde), wird gst-launch neu gestartet –
 * pipewiresrc liefert nach einem Formatwechsel sonst oft keine Bilder mehr.
 */

import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import dbus from 'dbus-next';

const PORTAL = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SCREENCAST = 'org.freedesktop.portal.ScreenCast';
const SOURCE_MONITOR = 1;
const SOURCE_WINDOW = 2;
const CURSOR_EMBEDDED = 2;
const RESTART_DELAY_MS = 500;
const SIZE_POLL_MS = 1000;

const log = (msg) => console.error(`[portal] ${msg}`);

let counter = 0;

async function call(bus, member, signature, body, iface = SCREENCAST, path = PORTAL_PATH) {
    const reply = await bus.call(new dbus.Message({
        destination: PORTAL, path, interface: iface, member, signature, body
    }));
    return reply.body;
}

/** Portal-Aufruf im Request/Response-Muster: erst auf das Signal hören, dann aufrufen. */
async function request(bus, member, signature, args, options) {
    const token = `erato${process.pid}_${++counter}`;
    const sender = bus.name.slice(1).replace(/\./g, '_');
    const path = `${PORTAL_PATH}/request/${sender}/${token}`;
    const match = `type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${path}'`;
    await addMatch(bus, match);
    const response = new Promise((resolve) => {
        const onMessage = (msg) => {
            if (msg.path !== path || msg.member !== 'Response') return;
            bus.off('message', onMessage);
            resolve(msg.body);
        };
        bus.on('message', onMessage);
    });
    options.handle_token = new dbus.Variant('s', token);
    await call(bus, member, signature, [...args, options]);
    const [code, results] = await response;
    if (code !== 0) throw new Error(code === 1 ? 'Freigabe abgebrochen' : `${member} fehlgeschlagen (Code ${code})`);
    return results;
}

// Signale bekommt der Low-Level-Client nur mit passender Match-Regel
async function addMatch(bus, rule) {
    await bus.call(new dbus.Message({
        destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [rule]
    }));
}

async function getProperty(bus, name) {
    const [variant] = await call(bus, 'Get', 'ss', [SCREENCAST, name], 'org.freedesktop.DBus.Properties');
    return variant.value;
}

/** object.serial und aktuelle Größe des Streams aus pw-dump. */
async function streamInfo(nodeId) {
    const { stdout } = await promisify(execFile)('pw-dump', [String(nodeId)], { maxBuffer: 16 << 20 });
    const node = JSON.parse(stdout).find(o => o.id === nodeId);
    if (!node) throw new Error(`PipeWire-Node ${nodeId} nicht gefunden`);
    const params = node.info?.params || {};
    const size = (params.Format?.[0] || params.EnumFormat?.[0])?.size;
    return {
        serial: node.info?.props?.['object.serial'],
        size: size?.width ? { width: size.width, height: size.height } : null
    };
}

/** Größe des eingepassten Bildes und Ränder, alles gerade für I420. */
function layout(src, width, height) {
    const scale = Math.min(width / src.width, height / src.height);
    const w = Math.min(width, Math.max(2, Math.round(src.width * scale / 2) * 2));
    const h = Math.min(height, Math.max(2, Math.round(src.height * scale / 2) * 2));
    const left = Math.floor((width - w) / 4) * 2;
    const top = Math.floor((height - h) / 4) * 2;
    return { w, h, left, right: width - w - left, top, bottom: height - h - top };
}

export class PortalCapture extends EventEmitter {
    constructor({ width, height, fps }) {
        super();
        this.width = width;
        this.height = height;
        this.fps = fps;
        this.frameBytes = width * height * 3 / 2;
        this.stdout = new PassThrough();
        this.stopped = false;
        this.child = null;
        this.restartTimer = null;
        this.pollTimer = null;
        this.start().catch((error) => {
            log(error.message);
            this.kill();
        });
    }

    async start() {
        this.bus = dbus.sessionBus();
        await new Promise((resolve, reject) => {
            if (this.bus.name) return resolve();
            this.bus.once('connect', resolve);
            this.bus.once('error', reject);
        });
        const bus = this.bus;

        const session = (await request(bus, 'CreateSession', 'a{sv}', [], {
            session_handle_token: new dbus.Variant('s', `erato${process.pid}`)
        })).session_handle.value;
        this.session = session;
        await addMatch(bus, `type='signal',interface='org.freedesktop.portal.Session',member='Closed',path='${session}'`);
        bus.on('message', (msg) => {
            if (msg.path === session && msg.member === 'Closed') {
                log('Freigabe vom Desktop beendet');
                this.kill();
            }
        });

        const sources = await getProperty(bus, 'AvailableSourceTypes');
        const cursors = await getProperty(bus, 'AvailableCursorModes');
        const options = {
            types: new dbus.Variant('u', sources & (SOURCE_MONITOR | SOURCE_WINDOW)),
            multiple: new dbus.Variant('b', false)
        };
        if (cursors & CURSOR_EMBEDDED) options.cursor_mode = new dbus.Variant('u', CURSOR_EMBEDDED);
        await request(bus, 'SelectSources', 'oa{sv}', [session], options);
        if (this.stopped) return;

        const results = await request(bus, 'Start', 'osa{sv}', [session, ''], {});
        const streams = results.streams?.value || [];
        if (!streams.length) throw new Error('Portal lieferte keinen Stream');
        this.nodeId = streams[0][0];
        log(`Stream läuft (PipeWire-Node ${this.nodeId})`);
        if (this.stopped) return;
        await this.launch();
        this.pollTimer = setInterval(() => this.checkSize(), SIZE_POLL_MS);
    }

    async checkSize() {
        if (this.restartTimer || !this.child) return;
        const { size } = await streamInfo(this.nodeId).catch(() => ({}));
        if (size && (size.width !== this.size.width || size.height !== this.size.height)) this.scheduleRestart(size);
    }

    async launch(size) {
        const info = await streamInfo(this.nodeId);
        if (this.stopped) return;
        const src = size || info.size || { width: this.width, height: this.height };
        const box = layout(src, this.width, this.height);
        this.size = src;

        const pipeline = [
            'pipewiresrc', `target-object=${info.serial}`, 'do-timestamp=true', 'keepalive-time=500', 'always-copy=true',
            '!', 'videoconvert', '!', 'videoscale',
            '!', `video/x-raw,format=I420,width=${box.w},height=${box.h}`,
            '!', 'videobox', `left=${-box.left}`, `right=${-box.right}`, `top=${-box.top}`, `bottom=${-box.bottom}`, 'fill=black',
            '!', `video/x-raw,format=I420,width=${this.width},height=${this.height}`,
            '!', 'videorate', '!', `video/x-raw,framerate=${this.fps}/1`,
            '!', 'fdsink', 'fd=1', 'sync=false'
        ];
        const child = spawn('gst-launch-1.0', ['-q', ...pipeline], { stdio: ['ignore', 'pipe', 'inherit'] });
        this.child = child;
        this.forwardFrames(child);
        child.on('exit', (code) => {
            if (this.child !== child) return; // absichtlich ersetzt
            this.child = null;
            if (!this.stopped) {
                if (code) log(`gst-launch beendet (Code ${code})`);
                this.kill();
            }
        });
    }

    // Nur ganze Frames weitergeben, damit ein Neustart das Raster nicht verschiebt
    forwardFrames(child) {
        let pending = Buffer.alloc(0);
        child.stdout.on('data', (chunk) => {
            if (this.child !== child) return;
            pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
            const whole = Math.floor(pending.length / this.frameBytes) * this.frameBytes;
            if (whole) {
                this.stdout.write(pending.subarray(0, whole));
                pending = pending.subarray(whole);
            }
        });
    }

    scheduleRestart(size) {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.stopped) return;
            const old = this.child;
            this.child = null;
            old?.kill();
            this.launch(size).catch((error) => {
                log(error.message);
                this.kill();
            });
        }, RESTART_DELAY_MS);
    }

    kill() {
        if (this.stopped) return;
        this.stopped = true;
        clearTimeout(this.restartTimer);
        clearInterval(this.pollTimer);
        this.child?.kill();
        this.child = null;
        if (this.session) {
            call(this.bus, 'Close', '', [], 'org.freedesktop.portal.Session', this.session).catch(() => { });
        }
        setTimeout(() => this.bus?.disconnect(), 200);
        this.stdout.end();
        this.emit('exit', 0);
    }
}

export function startPortalCapture(options) {
    return new PortalCapture(options);
}
