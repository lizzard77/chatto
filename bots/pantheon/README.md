# 🎲 Pantheon — Würfel-Bot für Chatto (Daggerheart, Savage Worlds, freies Würfeln)

- `bot.mjs` – Anbindung an Chatto und Commands.
  - **Eingang:** Realtime-WebSocket (`/api/realtime`, Protokoll 4, `LIVE_ONLY`). Der Bot sieht alle
    Nachrichten in Räumen, in denen er Mitglied ist und `message.read` hat, und reagiert auf `!…`.
  - **Ausgang:** `MessageService/CreateMessage` per ConnectRPC-JSON (Markdown), als Antwort auf die
    auslösende Nachricht (im selben Thread). `@` wird escaped, damit der Bot niemanden anpingt.
- `rolls.mjs` – Würfelregeln und Hilfetexte.
- `storage.mjs` – `storage/state.json`: GM-Modus pro User, Spielsystem pro Raum.
- `avatar.svg` / `avatar.png` – Profilbild (in Chatto beim Bot hochladen).
- `gen/` – Protobuf-Bindings für das Realtime-Protokoll (nur der Realtime-Proto und seine Imports;
  der WebSocket spricht ausschließlich binäres Protobuf).

## Commands

| Command | |
|---|---|
| `!system dh` / `swade` / `raw` | Spielsystem für den Raum (Standard: Daggerheart); `!system` zeigt es an |
| `!gm` / `!dm`, `!player`, `!mode` | GM-Modus pro User an/aus, aktuellen Modus zeigen |
| `!roll …` / `!r …` | Würfeln nach dem System des Raums, siehe unten |
| `!dice` (im Thread), `!dice aus` | Thread als Würfel-Sammelthread des Raums setzen / beenden |
| `!purge` (nur GM) | Nach der Session aufräumen: alle `!…`-Nachrichten und den Würfel-Thread löschen |
| `!ini …` / `!init …` | Savage-Worlds-Initiative mit Aktionsdeck, siehe unten |
| `!help` / `!hilfe` | Hilfe zu allen Systemen, das des Raums zuerst |

**Daggerheart:** `!roll` = Duality Dice (2d12 Hope + Fear), `+N`/`-N`, `adv`/`dis` (±d6).
Im GM-Modus 1d20 (GM's Die), kritisch auf natürliche 20.

**Savage Worlds:** `!roll d8+2` = Eigenschaftswurf mit Wild Die (d6), beide explodieren, der höhere
zählt; Zielwert 4, je 4 darüber eine Steigerung; 1 auf beiden = kritischer Fehlschlag.
`!roll dmg d8+2d6+1` = Schaden (alle Würfel explodieren und werden addiert, kein Wild Die).
Im GM-Modus ohne Wild Die (Extras), `!roll wild d8+1` mit (Wild Cards).
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

**Aufräumen nach der Session:** `!purge` (nur im GM-Modus) löscht im Raum alle Nachrichten, die mit
`!` anfangen – egal ob gültiger Befehl oder Tippfehler, auch in Threads – und den aktuellen
Würfel-Thread mit allen Antworten und der Kopfnachricht; danach ist kein Würfel-Thread mehr gesetzt.
Antworten des Bots außerhalb des Würfel-Threads bleiben stehen. Die Bestätigung („🧹 Aufgeräumt: …“)
löscht sich nach einer Minute selbst. Braucht `message.manage`.

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

Lokal gegen den Dev-Server: `npm ci && CHATTO_URL=http://localhost:4400 CHATTO_API_KEY=… node bot.mjs`.

## Protobuf-Bindings neu erzeugen

Nötig, wenn sich bei einem Chatto-Update das Realtime-Protokoll ändert:

```sh
npm i --no-save @bufbuild/protoc-gen-es@1.10.1 @bufbuild/buf
git -C ../../upstream archive HEAD proto | tar -x
rm -rf gen && npx buf generate proto --template buf.gen.yaml --path proto/chatto/realtime
rm -rf proto buf.gen.yaml && echo '{ "type": "module" }' > gen/package.json
```

Das erzeugt zusätzlich ein paar Dateien, die der Bot nicht lädt (z. B. `buf/validate/`); sie
können weg. `buf.gen.yaml` (`include_imports` erzeugt auch die importierten API-Protos):

```yaml
version: v2
plugins:
  - local: node_modules/.bin/protoc-gen-es
    out: gen
    include_imports: true
    opt: [target=js, import_extension=.js]
```
