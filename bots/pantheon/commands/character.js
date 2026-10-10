/**
 * Character Commands - !char create, !char update, !char
 */

const storage = require('../utils/storage');

const VALID_CLASSES = ['bard', 'druid', 'guardian', 'ranger', 'rogue', 'seraph', 'sorcerer', 'warrior', 'wizard'];
const VALID_TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];

/**
 * Zeigt den Charakter an (eigenen oder anderen)
 */
async function executeShow(client, roomId, sender, targetUser, sendHtmlMessage, targetUserId = null) {
    // Wenn kein targetUser angegeben, zeige eigenen Charakter
    const userId = targetUser ? (targetUserId || targetUser) : sender;
    const char = await storage.getCharacter(userId);
    
    if (!char) {
        const userDisplay = targetUser ? targetUser : 'Du';
        await sendHtmlMessage(
            roomId,
            `❌ ${userDisplay} hat keinen Charakter gefunden.`,
            `<font color="#ff6b6b">❌ ${userDisplay} hat keinen Charakter.</font>`
        );
        return;
    }
    
    // Zeige an, wessen Charakter das ist
    const ownerDisplay = targetUser ? `(${targetUser})` : '';
    
    let plain = `🧙 ${char.name || 'Unbenannt'} ${ownerDisplay}\n`;
    plain += `Level ${char.level || 1} ${char.class || 'Unbekannt'} (${char.subclass || '-'}), ${char.ancestry || 'Unbekannt'}\n`;
    plain += `Community: ${char.community || 'Unbekannt'}\n\n`;
    
    let html = `<font size="+1">🧙 <b>${char.name || 'Unbenannt'}</b></font>`;
    if (targetUser) {
        html += ` <font color="#888888">(${targetUser})</font>`;
    }
    html += `<br>`;
    html += `<font color="#4ecdc4">Level ${char.level || 1} ${char.class || 'Unbekannt'} (${char.subclass || '-'})</font>, ${char.ancestry || 'Unbekannt'}<br>`;
    html += `<font color="#888888">Community: ${char.community || 'Unbekannt'}</font><br><br>`;
    
    // Traits
    if (char.traits) {
        plain += 'Traits:\n';
        html += '<font color="#f1c40f"><b>Traits:</b></font><br>';
        for (const [trait, value] of Object.entries(char.traits)) {
            const sign = value >= 0 ? '+' : '';
            plain += `  ${trait}: ${sign}${value}\n`;
            html += `  ${trait}: <b>${sign}${value}</b><br>`;
        }
        plain += '\n';
        html += '<br>';
    }
    
    // HP, Stress, Hope
    plain += `HP: ${char.hp || 0}/${char.maxHp || 6}  |  Stress: ${char.stress || 0}/${char.maxStress || 6}  |  Hope: ${char.hope || 0}/6\n`;
    plain += `Evasion: ${char.evasion || 10}  |  Proficiency: ${char.proficiency || 1}`;
    
    html += `<font color="#ffffff">HP: ${char.hp || 0}/${char.maxHp || 6}</font> | `;
    html += `<font color="#9b59b6">Stress: ${char.stress || 0}/${char.maxStress || 6}</font> | `;
    html += `<font color="#f1c40f">Hope: ${char.hope || 0}/6</font><br>`;
    html += `<font color="#888888">Evasion: ${char.evasion || 10} | Proficiency: ${char.proficiency || 1}</font>`;
    
    await sendHtmlMessage(roomId, plain, html);
}

/**
 * Erstellt einen neuen Charakter
 */
async function executeCreate(client, roomId, args, sender, sendHtmlMessage) {
    if (args.length < 3) {
        await sendHtmlMessage(
            roomId,
            '❌ Verwendung: !char create Name Class Ancestry\nBeispiel: !char create Thorin Warrior Dwarf',
            '<font color="#ff6b6b">❌ Verwendung:</font> <code>!char create Name Class Ancestry</code><br>Beispiel: <code>!char create Thorin Warrior Dwarf</code>'
        );
        return;
    }
    
    const name = args[0];
    const charClass = args[1].toLowerCase();
    const ancestry = args[2];
    
    if (!VALID_CLASSES.includes(charClass)) {
        await sendHtmlMessage(
            roomId,
            `❌ Unbekannte Class: ${charClass}\nGültig: ${VALID_CLASSES.join(', ')}`,
            `<font color="#ff6b6b">❌ Unbekannte Class:</font> ${charClass}<br>Gültig: <code>${VALID_CLASSES.join(', ')}</code>`
        );
        return;
    }
    
    // Prüfe ob Charakter existiert
    const existing = await storage.getCharacter(sender);
    if (existing) {
        await sendHtmlMessage(
            roomId,
            '❌ Du hast bereits einen Charakter! Nutze !char update oder !char delete.',
            '<font color="#ff6b6b">❌ Du hast bereits einen Charakter!</font><br>Nutze <code>!char update</code> oder <code>!char delete</code>.'
        );
        return;
    }
    
    const character = {
        name,
        class: charClass,
        classDisplay: args[1], // Original-Schreibweise
        ancestry,
        subclass: '',
        community: '',
        level: 1,
        traits: {
            agility: 0,
            strength: 0,
            finesse: 0,
            instinct: 0,
            presence: 0,
            knowledge: 0
        },
        hp: 6,
        maxHp: 6,
        stress: 0,
        maxStress: 6,
        hope: 2,
        evasion: 10,
        proficiency: 1,
        created: new Date().toISOString()
    };
    
    await storage.saveCharacter(sender, character);
    
    await sendHtmlMessage(
        roomId,
        `✅ Charakter "${name}" erstellt!\nClass: ${charClass}, Ancestry: ${ancestry}\nNutze !char update um Traits zu setzen.`,
        `<font color="#4ecdc4">✅ Charakter "${name}" erstellt!</font><br>Class: <code>${charClass}</code>, Ancestry: <code>${ancestry}</code><br>Nutze <code>!char update</code> um Traits zu setzen.`
    );
}

/**
 * Aktualisiert Charakter-Daten
 */
async function executeUpdate(client, roomId, args, sender, sendHtmlMessage) {
    if (args.length < 2) {
        await sendHtmlMessage(
            roomId,
            '❌ Verwendung: !char update Feld Wert\nBeispiele:\n!char update traits +2,+1,+1,0,0,-1\n!char update name Thorin\n!char update hp 8\n!char update level 2',
            '<font color="#ff6b6b">❌ Verwendung:</font> <code>!char update Feld Wert</code><br>Beispiele:<br><code>!char update traits +2,+1,+1,0,0,-1</code><br><code>!char update name Thorin</code><br><code>!char update hp 8</code>'
        );
        return;
    }
    
    const char = await storage.getCharacter(sender);
    if (!char) {
        await sendHtmlMessage(
            roomId,
            '❌ Kein Charakter gefunden. Erstelle einen mit: !char create',
            '<font color="#ff6b6b">❌ Kein Charakter gefunden.</font><br>Erstelle einen mit: <code>!char create</code>'
        );
        return;
    }
    
    const field = args[0].toLowerCase();
    const value = args.slice(1).join(' ');
    
    switch (field) {
        case 'name':
            char.name = value;
            break;
        case 'class':
            if (!VALID_CLASSES.includes(value.toLowerCase())) {
                await sendHtmlMessage(roomId, `❌ Unbekannte Class: ${value}`, `<font color="#ff6b6b">❌ Unbekannte Class:</font> ${value}`);
                return;
            }
            char.class = value.toLowerCase();
            char.classDisplay = value;
            break;
        case 'ancestry':
            char.ancestry = value;
            break;
        case 'subclass':
            char.subclass = value;
            break;
        case 'community':
            char.community = value;
            break;
        case 'level':
            char.level = parseInt(value) || 1;
            break;
        case 'hp':
            char.hp = parseInt(value) || 0;
            break;
        case 'maxhp':
            char.maxHp = parseInt(value) || 6;
            break;
        case 'stress':
            char.stress = parseInt(value) || 0;
            break;
        case 'maxstress':
            char.maxStress = parseInt(value) || 6;
            break;
        case 'hope':
            char.hope = Math.min(6, parseInt(value) || 0);
            break;
        case 'evasion':
            char.evasion = parseInt(value) || 10;
            break;
        case 'proficiency':
            char.proficiency = parseInt(value) || 1;
            break;
        case 'traits':
            // Format: +2,+1,+1,0,0,-1
            const traitValues = value.split(',').map(v => parseInt(v.replace('+', '')) || 0);
            if (traitValues.length !== 6) {
                await sendHtmlMessage(
                    roomId,
                    '❌ Traits Format: +2,+1,+1,0,0,-1 (6 Werte für Agility, Strength, Finesse, Instinct, Presence, Knowledge)',
                    '<font color="#ff6b6b">❌ Traits Format:</font> <code>+2,+1,+1,0,0,-1</code><br>(6 Werte für Agility, Strength, Finesse, Instinct, Presence, Knowledge)'
                );
                return;
            }
            char.traits = {
                agility: traitValues[0],
                strength: traitValues[1],
                finesse: traitValues[2],
                instinct: traitValues[3],
                presence: traitValues[4],
                knowledge: traitValues[5]
            };
            break;
        default:
            await sendHtmlMessage(
                roomId,
                `❌ Unbekanntes Feld: ${field}\nGültig: name, class, ancestry, subclass, community, level, traits, hp, maxhp, stress, maxstress, hope, evasion, proficiency`,
                `<font color="#ff6b6b">❌ Unbekanntes Feld:</font> ${field}<br>Gültig: <code>name, class, ancestry, subclass, community, level, traits, hp, maxhp, stress, maxstress, hope, evasion, proficiency</code>`
            );
            return;
    }
    
    char.updated = new Date().toISOString();
    await storage.saveCharacter(sender, char);
    
    await sendHtmlMessage(
        roomId,
        `✅ ${field} aktualisiert auf: ${value}`,
        `<font color="#4ecdc4">✅</font> ${field} aktualisiert auf: <b>${value}</b>`
    );
}

/**
 * Haupt-Execute Funktion
 */
async function execute(client, roomId, args, sender, sendHtmlMessage, resolveUser = null) {
    const subCommand = args[0]?.toLowerCase();
    
    // Prüfe ob erstes Argument eine Erwähnung ist (@username)
    const firstArg = args[0];
    if (firstArg && firstArg.startsWith('@')) {
        const targetUserId = resolveUser ? resolveUser(firstArg) : null;
        await executeShow(client, roomId, sender, firstArg, sendHtmlMessage, targetUserId);
        return;
    }
    
    switch (subCommand) {
        case 'create':
            await executeCreate(client, roomId, args.slice(1), sender, sendHtmlMessage);
            break;
        case 'update':
            await executeUpdate(client, roomId, args.slice(1), sender, sendHtmlMessage);
            break;
        case 'delete':
            // TODO: Implement delete
            await sendHtmlMessage(roomId, '🗑️ Charakter löschen ist noch nicht implementiert.', '🗑️ Charakter löschen ist noch nicht implementiert.');
            break;
        default:
            // Ohne Subcommand: Eigenen Charakter anzeigen
            await executeShow(client, roomId, sender, null, sendHtmlMessage);
    }
}

module.exports = {
    name: 'char',
    aliases: ['character'],
    description: 'Charakter-Verwaltung (create, update, show)',
    execute
};
