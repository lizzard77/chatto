# 🎲 Pantheon — Würfel-Bot für Chatto (Daggerheart, Savage Worlds, freies Würfeln)

- `bot.mjs` – Anbindung an Chatto und Commands, über den offiziellen Client [`@chatto/client`](https://www.npmjs.com/package/@chatto/client).
  - **Eingang:** Realtime-Ereignisse (`consumeEvents`; Reconnect und Resume macht der Client). Der Bot
    sieht alle Nachrichten in Räumen, in denen er Mitglied ist und `message.read` hat, und reagiert auf `!…`.
  - **Ausgang:** `createMessage` (Markdown), als Antwort auf die auslösende Nachricht (im selben
    Thread). `@` wird escaped, damit der Bot niemanden anpingt.
- `rolls.mjs` – Würfelregeln und Hilfetexte.
- `storage.mjs` – `storage/state.json`: GM-Modus pro User, Spielsystem pro Raum.
- `avatar.svg` / `avatar.png` – Profilbild (in Chatto beim Bot hochladen).

## Commands

| Command | |
|---|---|
| `!system dh` / `swade` / `raw` | Spielsystem für den Raum (Standard: Daggerheart); `!system` zeigt es an |
| `!gm` / `!dm`, `!player`, `!mode` | GM-Modus pro User an/aus, aktuellen Modus zeigen |
| `!roll …` / `!r …` | Würfeln nach dem System des Raums, siehe unten |
| `!dice` (im Thread), `!dice aus` | Thread als Würfel-Sammelthread des Raums setzen / beenden |
| `!purge` | Nach der Session aufräumen: `!…`-Nachrichten und Bot-Nachrichten löschen, auch in Threads |
| `!ini …` / `!init …` | Savage-Worlds-Initiative mit Aktionsdeck, siehe unten |
| `!help` / `!hilfe` | Hilfe zu allen Systemen, das des Raums zuerst |

**Daggerheart:** `!roll` = Duality Dice (2d12 Hope + Fear), `+N`/`-N`, `adv`/`dis` (±d6).
Zwei W12 in einer Formel sind immer Hope + Fear, egal wie geschrieben (`2d12+2`, `2w12`, `d12+d12`),
auch im GM-Modus; `+d6`/`-d6` gelten dort als Vorteil/Nachteil, weitere Würfel werden addiert.
Im GM-Modus 1d20 (GM's Die), kritisch auf natürliche 20.

**Savage Worlds:** `!roll d8+2` = Eigenschaftswurf mit Wild Die (d6), beide explodieren, der höhere
zählt; Zielwert 4, je 4 darüber eine Steigerung; 1 auf beiden = kritischer Fehlschlag.
`!roll dmg d8+2d6+1` = Schaden (alle Würfel explodieren und werden addiert, kein Wild Die).
Im GM-Modus ohne Wild Die (Extras), `!roll wild d8+1` mit (Wild Cards); `!roll extra d8+1` würfelt in
beiden Modi ohne Wild Die (die Würfel-Leiste des Forks schickt `wild`/`extra` je nach Schalter „Mit Wild Die“).
Ein `x` hinter dem Würfel (`!roll 3d6x`, `!roll d8x+1`) würfelt einfach: explodiert nicht, kein Wild
Die, keine Auswertung – auch für Spieler.

**Initiative (nur Savage Worlds):** `!ini Ragnar Mira Goblins` zieht aus dem Aktionsdeck (52 Karten
+ 2 Joker) je eine Karte und gibt die Reihenfolge aus (Joker, Ass … 2, bei gleichem Wert ♠ ♥ ♦ ♣).
`!ini` zieht die nächste Runde für dieselben Teilnehmer, `!ini +Ork` / `!ini -Mira` ändert die Liste,
`!ini neu` mischt. Nach einer Runde mit Joker oder bei leerem Deck wird automatisch neu gemischt.
Namen mit Leerzeichen per Komma trennen. Deck und Teilnehmer liegen pro Raum in `storage/state.json`.
Edges wie Level Headed oder Quick wertet der Bot nicht aus.

**Freies Würfeln (`raw`):** `!roll 3w6+4` würfelt direkt nach der Notation, ohne Spielregeln
und unabhängig vom GM-Modus.

In allen Systemen geht freie Würfelnotation (`!roll 2d6+3`, `!roll 4d6kh3`) und Makros aus
`DEFAULT_MACROS`; `w`, `W` und `D` statt `d` (`3w6`, `3D6`) werden akzeptiert. Mehr als 999 Würfel auf einmal lehnt der Bot mit einer Meldung ab (Schaden in Savage Worlds: höchstens 10 je Würfeltyp). Ein nachträglich zum Befehl bearbeiteter Text (`roll 2d6` → `!roll 2d6`) wird ebenfalls ausgeführt.

**Würfel-Thread pro Session:** `!dice` in einem Thread macht ihn zum Sammelthread des Raums.
Ab dann landen alle Würfe (`!r …`, auch getippt im Kanal oder über den 🎲-Button des Forks,
Patch 0006) in diesem Thread; der Befehl verschwindet, die Antwort nennt den Würfelnden.
`!dice aus` beendet das. Ist der Thread gelöscht, antwortet der Bot wieder im Raum.
Würfe im GM-Modus tragen `;gm=1` im Marker; daran erkennt die Würfel-Leiste die SL-Ansicht.
Fehler und Hinweise auf Würfelbefehle (z. B. „Zu viele Würfel“) tragen einen unsichtbaren
Marker `[\u200b](#chatto-dice-note:by=<userId>)`; die Würfel-Leiste zeigt sie dem Würfelnden.

**Aufgeräumter Kanal:** Pantheon löscht die Befehlsnachricht (`!r 2d6`) nach seiner Antwort und
schreibt stattdessen den Namen des Würfelnden vor das Ergebnis (`**Phil** 🎲 **9** — 2d6: …`). Dafür
braucht der Bot `message.manage` in den Räumen; fehlt sie, bleibt der Befehl stehen (Warnung im Log).
Mit `DELETE_COMMANDS=false` antwortet er wie früher als Antwort auf den Befehl.

**Aufräumen nach der Session:** `!purge` (jeder im Raum) löscht im Raum und in allen Threads alle
Nachrichten, die mit `!` anfangen (egal ob gültiger Befehl oder Tippfehler), und alle Nachrichten
des Bots. Was Menschen schreiben, bleibt stehen – auch die Kopfnachricht des Würfel-Threads (etwa
ein Kartenbild) und Zeichnungen; der Würfel-Thread bleibt gesetzt. Die Bestätigung („🧹 Aufgeräumt:
…“) löscht sich nach einer Minute selbst. Braucht `message.manage`. Gelöschte Threads ohne Antworten
blendet der gepatchte Client aus (Patch 0008).

Alte Würfe von vor dieser Änderung räumt `cleanup.mjs` auf: Es schreibt den Namen vor jede alte
Antwort und löscht die beantworteten Befehle (nur Hauptzeitleiste, keine Threads). Ohne `APPLY=1`
nur ein Probelauf, der zählt:

```sh
ssh he1.lizzard77.dev 'docker exec -i chatto-pantheon node --input-type=module -' < cleanup.mjs
ssh he1.lizzard77.dev 'docker exec -i -e APPLY=1 -e ROOM=<roomId> chatto-pantheon node --input-type=module -' < cleanup.mjs
```

**3D-Würfel:** Jede Antwort bekommt einen Marker-Link `[🎲](#chatto-dice:…)` (Format: README im
Repo-Root). Der gepatchte Chatto-Client rollt die Würfel in 3D, bei Savage Worlds mit Wild Die und
Ergebnis-Banner (`;sw=`). Mit `DICE_3D=false` in `.env` lässt der Bot den Marker weg.

## Einrichtung

1. Chatto: **Server Admin → Bots → Create Bot** (Username `pantheon`), API-Key kopieren.
2. Auf der Detailseite des Bots für die gewünschten Räume (oder die Raumgruppe) erlauben:
   `room.join`, `message.read`, `message.post` und `message.manage` (zum Löschen der Befehle). Danach in der **Joined**-Zeile die Räume anhaken.
3. `.env` nach `.env.example` anlegen, `CHATTO_API_KEY` eintragen.
4. Image kommt aus GHCR (`ghcr.io/lizzard77/chatto-pantheon`, gebaut von `.github/workflows/images.yml`);
   `storage/` als Volume mounten.

Lokal gegen den Dev-Server: `scripts/dev-bots.sh pantheon` (legt den Bot dort bei Bedarf an).

## Chatto-Update

`@chatto/client` ist exakt gepinnt. Ändert sich bei einem Chatto-Update das Realtime-Protokoll,
meldet der Client den Server als nicht unterstützt; dann `npm i --save-exact @chatto/client@latest`.
