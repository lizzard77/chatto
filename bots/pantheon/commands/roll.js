/**
 * Roll Command - Daggerheart & RPG Würfel
 */

const { DiceRoll, Parser, Dice: { StandardDice }, Results: { RollResults } } = require('@dice-roller/rpg-dice-roller');
const { getUserMode } = require('../utils/storage');

/**
 * Parst Roll-Input für Standard RPG Würfel (nur Standard-Macros)
 */
function parseRollInput(input, defaultMacros) {
    const macros = defaultMacros;
    const lowerInput = input.toLowerCase().trim();
    
    if (macros[lowerInput]) {
        return { notation: macros[lowerInput], isMacro: true, macroName: lowerInput };
    }
    
    if (lowerInput === 'adv' || lowerInput === 'advantage') {
        return { notation: '2d20kh1', isMacro: false };
    }
    if (lowerInput === 'dis' || lowerInput === 'disadvantage') {
        return { notation: '2d20kl1', isMacro: false };
    }
    
    return { notation: input, isMacro: false };
}

/**
 * Formatiert Standard RPG Roll Ergebnis
 */
function formatRollResult(roll, isMacro = false, macroName = null) {
    let plain = '';
    let html = '';
    
    if (isMacro && macroName) {
        plain += `🎲 Macro: ${macroName} (${roll.notation})\n\n`;
        html += `<font size="+1">🎲 <b>Macro: ${macroName}</b></font> <font color="#888888">(${roll.notation})</font><br><br>`;
    } else {
        plain += `🎲 Wurf: ${roll.notation}\n\n`;
        html += `<font size="+1">🎲 <b>Wurf: ${roll.notation}</b></font><br><br>`;
    }
    
    const rolls = roll.rolls;
    if (rolls.length > 0) {
        const rollDetails = [];
        rolls.forEach(rollGroup => {
            if (Array.isArray(rollGroup.rolls)) {
                rollGroup.rolls.forEach(r => {
                    if (r.value !== undefined) {
                        const modifier = r.modifiers.length > 0 ? r.modifiers.join('') : '';
                        rollDetails.push(`${r.value}${modifier}`);
                    }
                });
            }
        });
        
        plain += `📊 Details: ${rollDetails.join(', ')}\n`;
        html += `<font color="#888888">📊 Details: ${rollDetails.join(', ')}</font><br>`;
    }
    
    plain += `\n💥 Ergebnis: ${roll.total}`;
    html += `<br><font color="#ffffff" size="+1">💥 <b>Ergebnis: ${roll.total}</b></font>`;
    
    // Kritische Treffer/Fehlschläge für d20
    if (roll.notation.includes('d20') && !roll.notation.includes('d200')) {
        if (roll.total === 20) {
            plain += ' 🔥 KRITISCHER ERFOLG!';
            html += ' <font color="#ff9500">🔥 <b>KRITISCHER ERFOLG!</b></font>';
        }
        if (roll.total === 1) {
            plain += ' 💀 Kritischer Fehlschlag!';
            html += ' <font color="#9b59b6">💀 <b>Kritischer Fehlschlag!</b></font>';
        }
    }
    
    return { plain, html };
}

/**
 * Einzelne Würfel eines RPG-Wurfs für die 3D-Anzeige im Chatto-Fork.
 * Nur einfache Notationen (NdX mit Modifiern); bei Gruppen o.ä. → keine Würfel.
 */
function rpgDice(notation, roll) {
    try {
        const parsed = Parser.parse(notation).filter(part => part instanceof StandardDice);
        const results = roll.rolls.filter(part => part instanceof RollResults);
        if (parsed.length !== results.length) return [];
        return results.flatMap((group, i) => group.rolls.map(r => ({
            kind: r.useInTotal ? 'std' : 'drop',
            sides: parsed[i].sides,
            value: r.value
        })));
    } catch {
        return [];
    }
}

function advDice(advType, value) {
    if (advType === 'adv') return [{ kind: 'adv', sides: 6, value }];
    if (advType === 'dis') return [{ kind: 'dis', sides: 6, value }];
    return [];
}

const MOD_COLOR = '#4ecdc4';
const ADV_COLOR = '#2ecc71';
const DIS_COLOR = '#e74c3c';

function rollAdvDie(advType) {
    if (advType !== 'adv' && advType !== 'dis') return { value: 0, sign: 0 };
    const value = Math.floor(Math.random() * 6) + 1;
    return { value, sign: advType === 'adv' ? +1 : -1 };
}

function buildFormulaParts(baseHtml, basePlain, modifier, advType, advValue) {
    const modText = modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    const advText = advType === 'adv' ? `+${advValue}⬆` : advType === 'dis' ? `-${advValue}⬇` : '';
    const advColor = advType === 'adv' ? ADV_COLOR : DIS_COLOR;

    const innerPlain = `${basePlain}${modText}${advText}`;
    const htmlParts = [
        `<font color="#888888">(</font>`,
        `<font color="#888888">${baseHtml}</font>`,
    ];
    if (modText) htmlParts.push(`<font color="${MOD_COLOR}">${modText}</font>`);
    if (advText) htmlParts.push(`<font color="${advColor}">${advText}</font>`);
    htmlParts.push(`<font color="#888888">)</font>`);
    return { innerPlain, formulaHtml: htmlParts.join('') };
}

/**
 * Führt Daggerheart Roll aus
 */
async function executeDaggerheart(modifier, advType, sendHtmlMessage, roomId) {
    const hopeDie = Math.floor(Math.random() * 12) + 1;
    const fearDie = Math.floor(Math.random() * 12) + 1;
    const adv = rollAdvDie(advType);
    const total = hopeDie + fearDie + modifier + adv.sign * adv.value;

    const isCritical = hopeDie === fearDie;
    const isHopeHigher = hopeDie > fearDie;

    let statusText = '';
    let statusColor = '';
    if (isCritical) {
        statusText = 'KRITISCH';
        statusColor = '#ff9500';
    } else if (isHopeHigher) {
        statusText = 'mit Hoffnung';
        statusColor = '#f1c40f';
    } else {
        statusText = 'mit Furcht';
        statusColor = '#9b59b6';
    }

    const { innerPlain, formulaHtml } = buildFormulaParts(
        `${hopeDie}+${fearDie}`, `${hopeDie}+${fearDie}`, modifier, advType, adv.value
    );

    const plain = `🗡️ ${total} (${innerPlain}) ${statusText}`.trim();
    const html = `<font color="#ffffff" size="+1">🗡️ <b>${total}</b></font> ${formulaHtml} <font color="${statusColor}"><b>${statusText}</b></font>`;

    const dice = [
        { kind: 'hope', sides: 12, value: hopeDie },
        { kind: 'fear', sides: 12, value: fearDie },
        ...advDice(advType, adv.value)
    ];
    await sendHtmlMessage(roomId, plain, html, dice);
}

/**
 * Führt GM Roll aus (Daggerheart GM's Die: 1d20 + Adversary-ATK)
 * Crit auf nat 20 (auto-success + max-Damage-Bonus auf Damage-Roll).
 */
async function executeGm(modifier, advType, sendHtmlMessage, roomId) {
    const die = Math.floor(Math.random() * 20) + 1;
    const adv = rollAdvDie(advType);
    const total = die + modifier + adv.sign * adv.value;
    const isCrit = die === 20;

    const { innerPlain, formulaHtml } = buildFormulaParts(
        `${die}`, `${die}`, modifier, advType, adv.value
    );

    const statusText = isCrit ? 'KRITISCH' : '';
    const statusColor = '#ff9500';

    const plain = `👹 ${total} (${innerPlain})${statusText ? ' ' + statusText : ''}`.trim();
    const html = `<font color="#ffffff" size="+1">👹 <b>${total}</b></font> ${formulaHtml}${statusText ? ` <font color="${statusColor}"><b>${statusText}</b></font>` : ''}`;

    const dice = [{ kind: 'gm', sides: 20, value: die }, ...advDice(advType, adv.value)];
    await sendHtmlMessage(roomId, plain, html, dice);
}

/**
 * Führt RPG Roll aus
 */
async function executeRpg(input, sender, sendHtmlMessage, roomId, defaultMacros) {
    const { notation, isMacro, macroName } = parseRollInput(input, defaultMacros);
    
    try {
        const roll = new DiceRoll(notation);
        const result = formatRollResult(roll, isMacro, macroName);
        
        await sendHtmlMessage(roomId, result.plain, result.html, rpgDice(notation, roll));
    } catch (error) {
        const plain = `❌ Ungültige Würfelnotation: "${input}"`;
        const html = `<font color="#ff6b6b">❌ Ungültige Würfelnotation:</font> <code>${input}</code>`;
        await sendHtmlMessage(roomId, plain, html);
    }
}

/**
 * Haupt-Execute Funktion
 */
async function execute(client, roomId, args, sender, sendHtmlMessage, defaultMacros) {
    // Parse Tokens: +N/-N als Modifier, adv/dis als Advantage/Disadvantage.
    // Alles andere → RPG-Fallback mit Original-Input.
    let modifier = 0;
    let advType = null;
    let unknownToken = null;

    for (const arg of args) {
        if (!arg) continue;
        const lower = arg.toLowerCase();
        if (lower === 'adv' || lower === 'advantage') {
            advType = 'adv';
        } else if (lower === 'dis' || lower === 'disadvantage') {
            advType = 'dis';
        } else if (/^[+-]\d+$/.test(arg)) {
            modifier = parseInt(arg);
        } else {
            unknownToken = arg;
            break;
        }
    }

    // Unbekannter Token → RPG-Pfad (Würfelnotation oder Macro)
    if (unknownToken !== null) {
        await executeRpg(args.join(''), sender, sendHtmlMessage, roomId, defaultMacros);
        return;
    }

    const mode = await getUserMode(sender);
    if (mode === 'gm') {
        await executeGm(modifier, advType, sendHtmlMessage, roomId);
    } else {
        await executeDaggerheart(modifier, advType, sendHtmlMessage, roomId);
    }
}

module.exports = {
    name: 'roll',
    aliases: ['r'],
    description: 'Würfelt Daggerheart (2d12) oder RPG-Würfel',
    execute
};
