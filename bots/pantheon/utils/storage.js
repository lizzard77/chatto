/**
 * Minimal Storage - Nur für Inventory
 */

const fs = require('fs').promises;
const path = require('path');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');

async function ensureUserDir(userId) {
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const userDir = path.join(STORAGE_DIR, cleanUserId);
    await fs.mkdir(userDir, { recursive: true });
    return userDir;
}

/**
 * Liest Inventory als Array von Einträgen
 */
async function readInventory(userId) {
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'inventory.jsonl');
    
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line.length > 0);
        return lines.map(line => JSON.parse(line)).filter(obj => obj !== null);
    } catch {
        return [];
    }
}

/**
 * Fügt Item zum Inventory hinzu (append)
 */
async function addToInventory(userId, itemName) {
    await ensureUserDir(userId);
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'inventory.jsonl');
    
    const entry = {
        action: 'add',
        item: itemName,
        timestamp: new Date().toISOString()
    };
    
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Entfernt Item aus Inventory (append mit action: remove)
 */
async function removeFromInventory(userId, itemName) {
    await ensureUserDir(userId);
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'inventory.jsonl');
    
    const entry = {
        action: 'remove',
        item: itemName,
        timestamp: new Date().toISOString()
    };
    
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Berechnet aktuelles Inventory (add - remove)
 * Behält Original-Schreibweise bei, zählt aber case-insensitive
 */
async function getCurrentInventory(userId) {
    const entries = await readInventory(userId);
    const counts = {}; // key: lowercase, value: count
    const names = {};  // key: lowercase, value: original name (letzte verwendete)
    
    entries.forEach(entry => {
        const itemLower = entry.item.toLowerCase();
        if (entry.action === 'add') {
            counts[itemLower] = (counts[itemLower] || 0) + 1;
            names[itemLower] = entry.item; // Original-Schreibweise speichern
        } else if (entry.action === 'remove') {
            counts[itemLower] = Math.max(0, (counts[itemLower] || 0) - 1);
        }
    });
    
    // Filtere Items mit 0 Count, verwende Original-Schreibweise
    return Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .map(([itemLower, count]) => ({ item: names[itemLower] || itemLower, count }));
}

/**
 * Charakter-Daten lesen
 */
async function getCharacter(userId) {
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'character.json');
    
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/**
 * Charakter-Daten speichern
 */
async function saveCharacter(userId, characterData) {
    await ensureUserDir(userId);
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'character.json');

    await fs.writeFile(filePath, JSON.stringify(characterData, null, 2), 'utf8');
}

/**
 * Liest den Roll-Mode des Users ('player' | 'gm'), Default: 'player'
 */
async function getUserMode(userId) {
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'mode.json');

    try {
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        return data.mode === 'gm' ? 'gm' : 'player';
    } catch {
        return 'player';
    }
}

/**
 * Setzt den Roll-Mode des Users ('player' | 'gm')
 */
async function setUserMode(userId, mode) {
    const normalized = mode === 'gm' ? 'gm' : 'player';
    await ensureUserDir(userId);
    const cleanUserId = userId.replace(/[@:]/g, '_');
    const filePath = path.join(STORAGE_DIR, cleanUserId, 'mode.json');

    await fs.writeFile(filePath, JSON.stringify({ mode: normalized }, null, 2), 'utf8');
    return normalized;
}

module.exports = {
    addToInventory,
    removeFromInventory,
    getCurrentInventory,
    getCharacter,
    saveCharacter,
    getUserMode,
    setUserMode
};
