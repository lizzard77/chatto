/**
 * Savage-Worlds-Initiative mit dem Aktionsdeck: 52 Karten plus 2 Joker.
 * Jede Runde bekommt jeder Teilnehmer eine Karte; gehandelt wird von der
 * höchsten zur niedrigsten (Joker, Ass … 2, bei gleichem Wert ♠ ♥ ♦ ♣).
 * Nach einer Runde mit Joker wird das Deck neu gemischt, ebenso wenn es leer ist.
 *
 * Der Zustand pro Raum ({ names, deck, reshuffle }) ist reines JSON und wird
 * von bot.mjs in storage/ gespeichert.
 */

import { randomInt } from 'node:crypto';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K', 'A'];
const SUITS = ['♣', '♦', '♥', '♠'];
// Karten als Zahlen: 0…51 = Rang * 4 + Farbe, 52 und 53 = Joker. Höher = früher dran.
const isJoker = (card) => card >= 52;

function shuffledDeck() {
    const deck = Array.from({ length: 54 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

const cardLabel = (card) => isJoker(card) ? '🃏 Joker' : `${RANKS[Math.floor(card / 4)]}${SUITS[card % 4]}`;

/**
 * Teilnehmer aus den Argumenten: mit Komma getrennt, wenn eines vorkommt
 * (Namen mit Leerzeichen), sonst je Wort einer.
 */
export function parseNames(args) {
    const joined = args.join(' ');
    const names = joined.includes(',') ? joined.split(',') : args;
    return [...new Set(names.map(n => n.trim()).filter(Boolean))].slice(0, 30);
}

/**
 * Zieht eine Runde. `state` ist der gespeicherte Zustand des Raums (oder undefined),
 * `names` die Teilnehmer dieser Runde. Gibt Text und neuen Zustand zurück.
 */
export function dealRound(state, names) {
    let deck = state?.deck ?? [];
    let shuffled = false;
    if (!state || state.reshuffle || deck.length < names.length) {
        deck = shuffledDeck();
        shuffled = true;
    } else {
        deck = [...deck];
    }

    const dealt = names.map(name => ({ name, card: deck.pop() }));
    dealt.sort((a, b) => b.card - a.card);
    const joker = dealt.some(d => isJoker(d.card));

    const lines = dealt.map((d, i) =>
        `${i + 1}. **${cardLabel(d.card)}** – ${d.name}${isJoker(d.card) ? ' (handelt jederzeit, +2 auf Eigenschaft und Schaden)' : ''}`);
    const notes = [];
    if (shuffled) notes.push('🔀 Deck neu gemischt');
    notes.push(joker ? '🃏 Joker gezogen – nach dieser Runde wird neu gemischt' : `${deck.length} Karten im Deck`);

    return {
        text: [`🃏 **Initiative**`, ...lines, `_${notes.join(' · ')}_`].join('\n'),
        state: { names, deck, reshuffle: joker }
    };
}

export const INITIATIVE_HELP = [
    '`!ini Ragnar Mira Goblins` → Aktionskarten für alle Genannten ziehen und Reihenfolge ausgeben',
    '`!ini` → nächste Runde mit denselben Teilnehmern; Namen mit Leerzeichen per Komma trennen',
    '`!ini +Ork` / `!ini -Mira` → Teilnehmer für die nächste Runde hinzufügen / entfernen',
    '`!ini neu` → Deck neu mischen (z. B. zu Beginn eines Kampfes)'
];
