/**
 * Inventory Command - !inv / !inventory
 * Usage: !inv + Schwert  oder  !inv - Apfel  oder  !inv add Trank  oder  !inv drop Gold
 */

const storage = require('../utils/storage');

async function execute(client, roomId, args, sender, sendHtmlMessage) {
    if (args.length < 1) {
        // Zeige aktuelles Inventory
        const inventory = await storage.getCurrentInventory(sender);
        
        if (inventory.length === 0) {
            await sendHtmlMessage(
                roomId,
                '🎒 Inventory ist leer.',
                '<font color="#888888">🎒 Inventory ist leer.</font>'
            );
            return;
        }
        
        let plain = '🎒 Dein Inventory:\n\n';
        let html = '<font size="+1">🎒 <b>Dein Inventory:</b></font><br><br>';
        
        inventory.forEach(({ item, count }) => {
            plain += `  ${count}x ${item}\n`;
            html += `<font color="#ffffff">${count}x</font> <font color="#4ecdc4">${item}</font><br>`;
        });
        
        await sendHtmlMessage(roomId, plain, html);
        return;
    }
    
    const operator = args[0].toLowerCase();
    const itemName = args.slice(1).join(' ');
    
    if (!itemName) {
        await sendHtmlMessage(
            roomId,
            '❌ Fehler: Gib einen Gegenstandsnamen an.',
            '<font color="#ff6b6b">❌ Fehler:</font> Gib einen Gegenstandsnamen an.'
        );
        return;
    }
    
    // Add Operationen
    if (operator === '+' || operator === 'add') {
        await storage.addToInventory(sender, itemName);
        
        await sendHtmlMessage(
            roomId,
            `✅ ${itemName} zum Inventory hinzugefügt.`,
            `<font color="#4ecdc4">✅</font> <font color="#ffffff">${itemName}</font> <font color="#4ecdc4">zum Inventory hinzugefügt.</font>`
        );
        return;
    }
    
    // Remove Operationen
    if (operator === '-' || operator === 'drop') {
        // Prüfe ob Item im Inventory existiert
        const currentInv = await storage.getCurrentInventory(sender);
        const itemLower = itemName.toLowerCase();
        const hasItem = currentInv.some(entry => entry.item.toLowerCase() === itemLower);
        
        if (!hasItem) {
            await sendHtmlMessage(
                roomId,
                `❌ "${itemName}" ist nicht in deinem Inventory.`,
                `<font color="#ff6b6b">❌</font> <font color="#ffffff">"${itemName}"</font> <font color="#ff6b6b">ist nicht in deinem Inventory.</font>`
            );
            return;
        }
        
        await storage.removeFromInventory(sender, itemName);
        
        await sendHtmlMessage(
            roomId,
            `🗑️ ${itemName} aus Inventory entfernt.`,
            `<font color="#ff6b6b">🗑️</font> <font color="#ffffff">${itemName}</font> <font color="#ff6b6b">aus Inventory entfernt.</font>`
        );
        return;
    }
    
    // Unbekannter Operator
    await sendHtmlMessage(
        roomId,
        '❌ Unbekannter Operator. Verwendung: !inv + Item  oder  !inv - Item',
        '<font color="#ff6b6b">❌ Unbekannter Operator.</font><br><font color="#888888">Verwendung: <code>!inv + Item</code> oder <code>!inv - Item</code></font>'
    );
}

module.exports = {
    name: 'inventory',
    aliases: ['inv'],
    description: 'Inventory Management (+ add, - remove)',
    execute
};
