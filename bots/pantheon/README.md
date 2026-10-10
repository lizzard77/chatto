# 🎲 Pantheon — Daggerheart Dice Bot für Chatto

Port des Matrix-Bots aus `selfhosted-services/he1/synapse/bot/pantheon`. Die Commands (`commands/`, `utils/`)
sind übernommen; neu ist nur die Anbindung in `bot.mjs`:

- **Eingang:** Realtime-WebSocket (`/api/realtime`, Protokoll 4, `LIVE_ONLY`). Der Bot sieht alle
  Nachrichten in Räumen, in denen er Mitglied ist und `message.read` hat, und reagiert auf `!…`.
- **Ausgang:** `MessageService/CreateMessage` per ConnectRPC-JSON, als Antwort auf die auslösende
  Nachricht (im selben Thread). Das HTML der Commands wird in Markdown übersetzt, `@` wird escaped,
  damit der Bot niemanden anpingt.
- `gen/` enthält die mit `protoc-gen-es@1.10.1` erzeugten Protobuf-Bindings aus `proto/` von
  **Chatto v0.5.0-beta.8** (Realtime-/Message-Protos unverändert bis beta.10). Bei einem Chatto-Update neu erzeugen, wenn sich das Realtime-Protokoll ändert.
- **3D-Würfel:** `!roll` hängt die gewürfelten Würfel als Marker-Link `[🎲](#chatto-dice:…)` an die
  Antwort (Format: `../fork/README.md`). Der gepatchte Chatto-Client rollt sie in 3D; mit
  `DICE_3D=false` in `.env` lässt der Bot den Marker weg.
- Daten (Inventar, Charakter, Mode) liegen pro Chatto-User-ID unter `storage/`.

## Einrichtung

1. Chatto: **Server Admin → Bots → Create Bot** (Username `pantheon`), API-Key kopieren.
2. Auf der Detailseite des Bots für die gewünschten Räume (oder die Raumgruppe) erlauben:
   `room.join`, `message.read`, `message.post`. Danach in der **Joined**-Zeile die Räume anhaken.
3. Auf he1 in `selfhosted-services/he1/chatto/pantheon/.env` `CHATTO_API_KEY` eintragen (Vorlage: `.env.example`).
4. Image kommt aus GHCR (`ghcr.io/lizzard77/chatto-pantheon`, gebaut von `.github/workflows/images.yml`):
   auf he1 in `he1/chatto` → `docker compose pull pantheon && docker compose up -d pantheon`

Protobuf-Bindings neu erzeugen (für eine neue Chatto-Version `vX.Y.Z`):

```sh
npm i -D @bufbuild/protoc-gen-es@1.10.1 @bufbuild/buf
git -C <chatto-checkout> archive vX.Y.Z proto | tar -x
npx buf generate proto --template buf.gen.yaml --path proto/chatto/realtime --path proto/chatto/api
```

`buf.gen.yaml`:

```yaml
version: v2
plugins:
  - local: node_modules/.bin/protoc-gen-es
    out: gen
    opt: [target=js, import_extension=.js]
```
