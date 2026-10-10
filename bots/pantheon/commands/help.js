/**
 * Help Command - Zeigt die Hilfe an
 */

// Hilfe-Texte (Plain + HTML)
const HELP_TEXT_PLAIN = `🎲 Daggerheart Dice Bot 🎲

Player-Mode (Default):
!roll → Würfelt 2d12 (Hope+Fear)
!roll +2 → Mit +2 Bonus
!roll -1 → Mit -1 Malus
!roll adv → Mit Advantage (+d6)
!roll dis → Mit Disadvantage (-d6)
!roll +2 adv → Bonus + Advantage kombinierbar

GM-Mode:
!gm → GM-Mode aktivieren (!roll = 1d20 GM's Die)
!player → Zurück zum Player-Mode
!mode → Aktuellen Mode anzeigen
Im GM-Mode: !roll +3 = 1d20+3 (Adversary ATK), Crit auf nat 20
adv/dis funktionieren im GM-Mode genauso (+/-d6)

!inv → Zeigt dein Inventory
!inv + Schwert → Item hinzufügen
!inv - Apfel → Item entfernen

!char → Zeigt deinen Charakter
!char @spieler → Zeigt Charakter eines anderen
!char create Name Class Ancestry → Erstellt Charakter
!char update traits +2,+1,+1,0,0,-1 → Setzt Traits
!char update hp 8 → Aktualisiert HP

Classes: bard, druid, guardian, ranger, rogue, seraph, sorcerer, warrior, wizard
Traits: agility, strength, finesse, instinct, presence, knowledge
Stats: name, class, ancestry, subclass, community, level, hp, maxhp, stress, maxstress, hope, evasion, proficiency

Beispiele:
• !roll → 2d12, Summe, Hope/Fear/Critical (Player) bzw. 1d20 (GM)
• !roll 2d6+3 → Normale RPG-Würfel
• !inv + Langschwert → Zum Inventar hinzufügen
• !char create Thorin Warrior Dwarf
• !char update level 2
• !char @simon → Zeigt Simons Charakter

Daggerheart: Hope+Fear = Ergebnis, höherer Würfel bestimmt Hope/Fear, Matching = Critical`;

const HELP_TEXT_HTML = `<font size="+1">🎲 <b>Daggerheart Dice Bot</b> 🎲</font><br><br>
<font color="#ffffff"><b>Player-Mode</b> (Default):</font><br>
<font color="#4ecdc4">!roll</font> → Würfelt 2d12 (Hope+Fear)<br>
<font color="#4ecdc4">!roll +2</font> → Mit +2 Bonus<br>
<font color="#4ecdc4">!roll -1</font> → Mit -1 Malus<br>
<font color="#4ecdc4">!roll adv</font> → Mit Advantage (+d6)<br>
<font color="#4ecdc4">!roll dis</font> → Mit Disadvantage (-d6)<br>
<font color="#4ecdc4">!roll +2 adv</font> → Bonus + Advantage kombinierbar<br><br>
<font color="#ffffff"><b>GM-Mode</b>:</font><br>
<font color="#ff9500">!gm</font> → GM-Mode aktivieren (<code>!roll</code> = 1d20 GM's Die)<br>
<font color="#ff9500">!player</font> → Zurück zum Player-Mode<br>
<font color="#ff9500">!mode</font> → Aktuellen Mode anzeigen<br>
<font color="#888888">Im GM-Mode: <code>!roll +3</code> = 1d20+3 (Adversary ATK), Crit auf nat 20</font><br>
<font color="#888888">adv/dis funktionieren im GM-Mode genauso (+/-d6)</font><br><br>
<font color="#f1c40f">!inv</font> → Zeigt dein Inventory<br>
<font color="#f1c40f">!inv + Schwert</font> → Item hinzufügen<br>
<font color="#f1c40f">!inv - Apfel</font> → Item entfernen<br><br>
<font color="#9b59b6">!char</font> → Zeigt deinen Charakter<br>
<font color="#9b59b6">!char @spieler</font> → Zeigt Charakter eines anderen<br>
<font color="#9b59b6">!char create Name Class Ancestry</font> → Erstellt Charakter<br>
<font color="#9b59b6">!char update traits +2,+1,+1,0,0,-1</font> → Setzt Traits<br>
<font color="#9b59b6">!char update hp 8</font> → Aktualisiert HP/Level/etc.<br><br>
<font color="#888888">Classes:</font> <code>bard, druid, guardian, ranger, rogue, seraph, sorcerer, warrior, wizard</code><br>
<font color="#888888">Traits:</font> <code>agility, strength, finesse, instinct, presence, knowledge</code><br>
<font color="#888888">Stats:</font> <code>name, class, ancestry, subclass, community, level, hp, maxhp, stress, maxstress, hope, evasion, proficiency</code><br><br>
<font color="#ffffff"><b>Beispiele:</b></font><br>
• !roll → 2d12, Summe, Hope/Fear/Critical<br>
• !roll 2d6+3 → Normale RPG-Würfel<br>
• !inv + Langschwert → Zum Inventar hinzufügen<br>
• !char create Thorin Warrior Dwarf<br>
• !char update level 2<br><br>
<font size="-1" color="#888888">Daggerheart: Hope+Fear = Ergebnis, höherer Würfel bestimmt Hope/Fear, Matching = Critical</font>`;

/**
 * Sendet die Hilfe an den Raum
 * @param {Object} client - Matrix Client
 * @param {string} roomId - Raum ID
 * @param {Function} sendHtmlMessage - HTML Message Helper
 */
async function execute(client, roomId, sendHtmlMessage) {
    await sendHtmlMessage(roomId, HELP_TEXT_PLAIN, HELP_TEXT_HTML);
}

module.exports = {
    name: 'help',
    aliases: ['hilfe'],
    description: 'Zeigt die Hilfe an',
    execute
};
