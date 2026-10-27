/**
 * Würfelregeln für Daggerheart, Savage Worlds (SWADE) und freies Würfeln (raw).
 *
 * Jede Funktion liefert { text, dice, swade }: `text` ist Markdown für den Chat,
 * `dice` die einzelnen Würfel für den 3D-Marker (Format: README des Forks),
 * `swade` das Ergebnis eines SWADE-Eigenschaftswurfs für das 3D-Banner.
 */

import { DiceRoll, Parser, Dice, Results } from '@dice-roller/rpg-dice-roller';
import { INITIATIVE_HELP } from './initiative.mjs';

const die = (sides) => Math.floor(Math.random() * sides) + 1;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '');

// ---------------------------------------------------------------------------
// Daggerheart
// ---------------------------------------------------------------------------

// `+2`, `-1`, `adv`, `dis` in beliebiger Reihenfolge; sonst null.
function parseDaggerheartArgs(args) {
    let modifier = 0;
    let adv = null;
    for (const arg of args) {
        const lower = arg.toLowerCase();
        if (lower === 'adv' || lower === 'advantage') adv = 'adv';
        else if (lower === 'dis' || lower === 'disadvantage') adv = 'dis';
        else if (/^[+-]\d+$/.test(arg)) modifier += parseInt(arg, 10);
        else return null;
    }
    return { modifier, adv };
}

function advantage(adv) {
    if (!adv) return { value: 0, text: '', dice: [] };
    const value = die(6);
    return {
        value: adv === 'adv' ? value : -value,
        text: adv === 'adv' ? `+${value}⬆` : `-${value}⬇`,
        dice: [{ kind: adv, sides: 6, value }]
    };
}

/**
 * Formel mit genau zwei W12 (`2d12+3`, `2w12`, `d12+d12-1`, `2d12+d6 adv`) → Duality-Wurf;
 * sonst null. `+d6` / `-d6` gelten als Vorteil / Nachteil, weitere Würfel werden addiert.
 */
function parseDualityFormula(args) {
    let adv = null;
    const rest = [];
    for (const arg of args) {
        const lower = arg.toLowerCase();
        if (lower === 'adv' || lower === 'advantage') adv = 'adv';
        else if (lower === 'dis' || lower === 'disadvantage') adv = 'dis';
        else rest.push(lower);
    }
    const input = rest.join('');
    const tokens = input.match(/[+-]?[^+-]+/g);
    if (!tokens || tokens.join('') !== input) return null;
    let d12 = 0;
    let modifier = 0;
    const extra = [];
    for (const token of tokens) {
        const m = /^([+-]?)(\d*)[dw](\d+)$/.exec(token);
        if (m) {
            const sign = m[1] === '-' ? -1 : 1;
            const count = m[2] ? parseInt(m[2], 10) : 1;
            const sides = parseInt(m[3], 10);
            if (count < 1 || count > 10 || sides < 2 || sides > 100) return null;
            if (sides === 12 && sign > 0) d12 += count;
            else if (sides === 6 && count === 1 && !adv) adv = sign > 0 ? 'adv' : 'dis';
            else extra.push({ sign, count, sides });
        } else if (/^[+-]?\d+$/.test(token)) {
            modifier += parseInt(token, 10);
        } else {
            return null;
        }
    }
    return d12 === 2 ? { modifier, adv, extra } : null;
}

/** Spieler: Duality Dice (2d12 Hope + Fear), optional mit weiteren Würfeln aus einer Formel. */
function daggerheartPlayer({ modifier, adv, extra = [] }) {
    const hope = die(12);
    const fear = die(12);
    const a = advantage(adv);
    const dice = [{ kind: 'hope', sides: 12, value: hope }, { kind: 'fear', sides: 12, value: fear }, ...a.dice];
    let extraValue = 0;
    let extraText = '';
    for (const { sign, count, sides } of extra) {
        const values = Array.from({ length: count }, () => die(sides));
        extraValue += sign * values.reduce((x, y) => x + y, 0);
        extraText += `${sign < 0 ? '-' : '+'}${count > 1 ? count : ''}d${sides}[${values.join(',')}]`;
        dice.push(...values.map(value => ({ kind: 'std', sides, value })));
    }
    const total = hope + fear + modifier + a.value + extraValue;
    const status = hope === fear ? '**KRITISCH**' : hope > fear ? '**mit Hoffnung**' : '**mit Furcht**';
    return {
        text: `🗡️ **${total}** (${hope}+${fear}${extraText}${signed(modifier)}${a.text}) ${status}`,
        dice
    };
}

/** GM: GM's Die (1d20 + Adversary-ATK), kritisch auf natürliche 20. */
function daggerheartGm({ modifier, adv }) {
    const value = die(20);
    const a = advantage(adv);
    const total = value + modifier + a.value;
    return {
        text: `👹 **${total}** (${value}${signed(modifier)}${a.text})${value === 20 ? ' **KRITISCH**' : ''}`,
        dice: [{ kind: 'gm', sides: 20, value }, ...a.dice]
    };
}

// ---------------------------------------------------------------------------
// Savage Worlds
// ---------------------------------------------------------------------------

// Explodierender Würfel („Ace“): bei Höchstzahl nachwürfeln und addieren.
function ace(sides) {
    const rolls = [];
    do rolls.push(die(sides)); while (rolls.at(-1) === sides && rolls.length < 10);
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

const chain = ({ rolls }) => rolls.join('+') + (rolls.length > 1 ? ' 💥' : '');

// `d8+2d6+3-1` (auch `w8+2w6`) → Würfelterme und Modifikator; null bei anderer Syntax.
function parseSwadeTerms(input) {
    const tokens = input.toLowerCase().match(/[+-]?[^+-]+/g);
    if (!tokens) return null;
    const terms = [];
    let modifier = 0;
    for (const token of tokens) {
        const m = /^([+-]?)(\d*)[dw](\d+)$/.exec(token);
        if (m) {
            if (m[1] === '-') return null;
            const count = m[2] ? parseInt(m[2], 10) : 1;
            const sides = parseInt(m[3], 10);
            if (count < 1 || count > 10 || sides < 2 || sides > 100) return null;
            terms.push({ count, sides });
        } else if (/^[+-]\d+$/.test(token)) {
            modifier += parseInt(token, 10);
        } else {
            return null;
        }
    }
    return terms.length ? { terms, modifier } : null;
}

/**
 * Eigenschaftswurf: ein Würfel (z. B. d8+1), Zielwert 4, je 4 darüber eine Steigerung.
 * Mit Wild Die (d6) zählt der höhere; 1 auf beiden ist ein kritischer Fehlschlag.
 */
function swadeTrait({ terms: [{ sides }], modifier }, { wild, gm }) {
    const trait = ace(sides);
    const wildDie = wild ? ace(6) : null;
    const best = wildDie && wildDie.total > trait.total ? wildDie : trait;
    const total = best.total + modifier;

    let swade;
    let status;
    if (wildDie && trait.rolls[0] === 1 && wildDie.rolls[0] === 1) {
        swade = 'cf';
        status = '**Kritischer Fehlschlag!**';
    } else if (total < 4) {
        swade = 'fail';
        status = 'Fehlschlag';
    } else {
        const raises = Math.floor((total - 4) / 4);
        swade = raises;
        status = raises === 0 ? '**Erfolg**' : `**Erfolg mit ${raises === 1 ? 'Steigerung' : `${raises} Steigerungen`}**`;
    }

    const strike = (part, used) => (wildDie && !used ? `~~${part}~~` : part);
    const parts = [strike(`d${sides}: ${chain(trait)}`, best === trait)];
    if (wildDie) parts.push(strike(`Wild: ${chain(wildDie)}`, best === wildDie));
    if (modifier) parts.push(signed(modifier));

    const traitKind = gm ? 'gm' : 'std';
    const dice = [
        ...trait.rolls.map(value => ({ kind: traitKind, sides, value })),
        ...(wildDie ? wildDie.rolls.map(value => ({ kind: 'wild', sides: 6, value })) : [])
    ];
    return { text: `${gm ? '👹' : '⚔️'} **${total}** (${parts.join(' · ')}) — ${status}`, dice, swade };
}

/** Schaden: alle Würfel explodieren und werden addiert, kein Wild Die. */
function swadeDamage({ terms, modifier }) {
    const dice = [];
    const parts = [];
    let total = modifier;
    for (const { count, sides } of terms) {
        const results = Array.from({ length: count }, () => ace(sides));
        for (const r of results) {
            total += r.total;
            dice.push(...r.rolls.map(value => ({ kind: 'std', sides, value })));
        }
        parts.push(`${count > 1 ? count : ''}d${sides}: ${results.map(chain).join(', ')}`);
    }
    if (modifier) parts.push(signed(modifier));
    return { text: `💥 **${total}** Schaden (${parts.join(' · ')})`, dice };
}

// ---------------------------------------------------------------------------
// Freie Würfelnotation (beide Systeme), z. B. 2d6+3, 4d6kh3 oder ein Makro
// ---------------------------------------------------------------------------

// Einzelne Würfel für die 3D-Anzeige; nur einfache NdX-Notationen.
function notationDice(roll) {
    try {
        const parsed = Parser.parse(roll.notation).filter(p => p instanceof Dice.StandardDice);
        const results = roll.rolls.filter(p => p instanceof Results.RollResults);
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

// Deutsche Schreibweise: `3w6+4` → `3d6+4`, `w%` → `d%`
// Schreibweisen vereinheitlichen: `3w6`, `3W6`, `3D6` → `3d6`, `w%` → `d%`
const germanDice = (input) => input.replace(/(\d*)[wd](?=\d|%)/gi, '$1d');

// Mehr Würfel kann die Bibliothek nicht auf einmal werfen
export const MAX_DICE = 999;

// Gesamtzahl der Würfel in einer Notation, z. B. `3d6+2d8` → 5
function diceCount(input) {
    let total = 0;
    for (const m of input.matchAll(/(\d*)d(?=\d|%|f)/gi)) total += m[1] ? parseInt(m[1], 10) : 1;
    return total;
}

function notation(input, macros) {
    const macro = macros[input.toLowerCase()];
    const normalized = macro || germanDice(input);
    const count = diceCount(normalized);
    if (count > MAX_DICE) {
        return { text: `❌ Zu viele Würfel: höchstens ${MAX_DICE} auf einmal (\`${input}\` wären ${count}).` };
    }
    let roll;
    try {
        roll = new DiceRoll(normalized);
    } catch {
        return { text: `❌ Ungültige Würfelnotation: \`${input}\` – Beispiele: \`2d6+3\`, \`3w6\`, \`4d6kh3\`` };
    }
    const label = macro ? `${input.toLowerCase()} (${roll.notation})` : roll.notation;
    return { text: `🎲 **${roll.total}** — ${label}: ${roll.output.replace(/^[^:]*:\s*/, '')}`, dice: notationDice(roll) };
}

// ---------------------------------------------------------------------------
// !roll
// ---------------------------------------------------------------------------

/**
 * @param {string[]} args  Argumente nach `!roll`
 * @param {{ system: 'dh'|'swade'|'raw', gm: boolean, macros: object }} ctx
 */
export function roll(args, { system, gm, macros }) {
    if (system === 'raw') {
        const input = args.join('');
        if (!input) return { text: '🎲 Freies Würfeln: `!roll 3w6+4`, `!roll 2d20kh1`' };
        return notation(input, macros);
    }

    if (system === 'swade') {
        let prefix = args[0]?.toLowerCase();
        // `wild` / `extra`: Eigenschaftswurf mit bzw. ohne Wild Die, unabhängig vom GM-Modus
        if (prefix === 'dmg' || prefix === 'wild' || prefix === 'extra') args = args.slice(1);
        else prefix = null;
        let input = args.join('');
        if (!input) return { text: '⚔️ Savage Worlds: `!roll d8+1`, Schaden mit `!roll dmg d8+2d6`' };
        // `x` hinter einem Würfel (`3d6x`, `d8x+1`): einfacher Wurf, explodiert nicht, kein Wild Die
        if (prefix !== 'dmg' && /[dw]\d+x/i.test(input)) {
            return notation(input.toLowerCase().replace(/([dw]\d+)x/g, '$1'), macros);
        }
        const parsed = parseSwadeTerms(input);
        if (prefix === 'dmg') {
            if (parsed) return swadeDamage(parsed);
            return /(\d{2,})[dw]/i.test(input) && parseInt(input.match(/(\d{2,})[dw]/i)[1], 10) > 10
                ? { text: `❌ Zu viele Schadenswürfel: höchstens 10 je Würfeltyp (\`${input}\`).` }
                : { text: `❌ Ungültiger Schadenswurf: \`${input}\` – Beispiel: \`!roll dmg d8+2d6+1\`` };
        }
        if (parsed && parsed.terms.length === 1 && parsed.terms[0].count === 1) {
            const wild = prefix === 'wild' || (prefix !== 'extra' && !gm);
            return swadeTrait(parsed, { wild, gm });
        }
        return notation(input, macros);
    }

    const dh = parseDaggerheartArgs(args);
    if (dh) return gm ? daggerheartGm(dh) : daggerheartPlayer(dh);
    // Zwei W12 sind in Daggerheart immer Hoffnung + Furcht, egal wie geschrieben, auch im GM-Modus
    const duality = parseDualityFormula(args);
    if (duality) return daggerheartPlayer(duality);
    return notation(args.join(''), macros);
}

export const SYSTEMS = {
    dh: 'Daggerheart',
    swade: 'Savage Worlds',
    raw: 'Freies Würfeln'
};

export function modeText(system, gm) {
    if (system === 'raw') return '🎲 `!roll 3w6+4` würfelt direkt, ohne Spielregeln';
    if (system === 'swade') {
        return gm
            ? '👹 GM: `!roll d8+1` ohne Wild Die (Extra), `!roll wild d8+1` mit Wild Die (Wild Card)'
            : '⚔️ Spieler: `!roll d8+1` mit Wild Die';
    }
    return gm ? '👹 GM: `!roll` = 1d20 (GM\'s Die)' : '🗡️ Spieler: `!roll` = Duality Dice (2d12 Hope + Fear)';
}

const HELP = {
    dh: [
        '🗡️ **Daggerheart** (`!system dh`)',
        '`!roll` → Duality Dice (2d12 Hope + Fear); höherer Würfel bestimmt Hoffnung/Furcht, Pasch = kritisch',
        '`!roll +2`, `!roll -1` → Modifikator',
        '`!roll adv` / `!roll dis` → Vorteil (+d6) / Nachteil (−d6), kombinierbar: `!roll +2 adv`',
        '`!roll 2d12+2` (auch `2w12`, `d12+d12`) → immer Hoffnung + Furcht, auch im GM-Modus; `+d6` / `-d6` = Vorteil / Nachteil',
        'GM-Modus: `!roll +3` = 1d20+3 (GM\'s Die), kritisch auf natürliche 20; adv/dis wie oben'
    ],
    swade: [
        '⚔️ **Savage Worlds** (`!system swade`)',
        '`!roll d8+2` → Eigenschaftswurf: d8 und Wild Die (d6), beide explodieren, der höhere zählt;',
        'Zielwert 4, je 4 darüber eine Steigerung; 1 auf beiden Würfeln = kritischer Fehlschlag',
        '`!roll d4-2` → ungeübt',
        '`!roll dmg d8+2d6+1` → Schaden: alle Würfel explodieren und werden addiert, kein Wild Die',
        '`!roll 3d6x`, `!roll d8x+1` → einfacher Wurf: explodiert nicht, kein Wild Die, keine Steigerungen',
        ...INITIATIVE_HELP,
        'GM-Modus: `!roll d8+1` ohne Wild Die (Extras), `!roll wild d8+1` mit Wild Die (Wild Cards); `!roll extra d8+1` immer ohne'
    ],
    raw: [
        '🎲 **Freies Würfeln** (`!system raw`)',
        '`!roll 3w6+4` / `!roll 3d6+4` → würfelt direkt, ohne Spielregeln; GM-Modus egal',
        '`!roll 4d6kh3`, `!roll 2w20kl1`, `!roll d%` → volle Würfelnotation, auch Makros'
    ]
};

export function helpText(system) {
    const others = Object.keys(SYSTEMS).filter(s => s !== system);
    return [
        `🎲 **Pantheon** — System in diesem Raum: **${SYSTEMS[system]}**`,
        '',
        ...HELP[system],
        ...others.flatMap(s => ['', ...HELP[s]]),
        '',
        '**Modus und System**',
        '`!system dh` / `!system swade` / `!system raw` → System für diesen Raum umschalten (`!system` zeigt es an)',
        '`!gm` (oder `!dm`) → GM-Modus, `!player` → zurück, `!mode` → aktueller Modus',
        '`!dice` in einem Thread → Würfel-Thread der Session: alle Würfe des Raums landen dort, `!dice aus` beendet ihn',
        '`!purge` → nach der Session aufräumen: löscht alle `!…`-Nachrichten und Bot-Nachrichten, auch in Threads; was Menschen schreiben, bleibt (außer in Threads mit gelöschter Kopfnachricht)',
        '`!help` → diese Hilfe',
        '',
        'In allen Systemen: `!roll 2d6+3` (oder `2w6+3`), `!roll 4d6kh3` → freie Würfelnotation, auch Makros wie `!roll fireball`'
    ].join('\n');
}
