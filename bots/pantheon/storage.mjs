/**
 * Zustand des Bots: GM-Modus pro User, Spielsystem und Initiative pro Raum.
 * Eine JSON-Datei unter storage/ (im Container als Volume gemountet).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'storage');
const FILE = path.join(DIR, 'state.json');

let state = { users: {}, rooms: {} };
try {
    state = { ...state, ...JSON.parse(await readFile(FILE, 'utf8')) };
} catch (error) {
    if (error.code !== 'ENOENT') console.warn('Warnung: storage/state.json nicht lesbar:', error.message);
}

let writing = Promise.resolve();
function save() {
    writing = writing.then(async () => {
        await mkdir(DIR, { recursive: true });
        await writeFile(`${FILE}.tmp`, JSON.stringify(state, null, 2));
        await rename(`${FILE}.tmp`, FILE);
    }).catch(error => console.error('storage/state.json nicht gespeichert:', error.message));
    return writing;
}

export const isGm = (userId) => state.users[userId]?.gm === true;

export function setGm(userId, gm) {
    state.users[userId] = { ...state.users[userId], gm };
    return save();
}

export const roomSystem = (roomId) => state.rooms[roomId]?.system ?? 'dh';

/** Initiative-Zustand des Raums (Teilnehmer, Aktionsdeck), siehe initiative.mjs. */
export const roomInitiative = (roomId) => state.rooms[roomId]?.initiative;

export function setRoomInitiative(roomId, initiative) {
    state.rooms[roomId] = { ...state.rooms[roomId], initiative };
    return save();
}

export function setRoomSystem(roomId, system) {
    state.rooms[roomId] = { ...state.rooms[roomId], system };
    return save();
}
