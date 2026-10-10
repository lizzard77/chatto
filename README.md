# Chatto – Lizzard-Fork

Phils Erweiterungen für [Chatto](https://github.com/chattocorp/chatto): Patches auf den Upstream-Code,
Bots, lokale Dev-Umgebung und die GitHub-Action, die die Images für he1 baut.

Dieser Branch (`fork`, Standard-Branch des Forks `lizzard77/chatto`) enthält **keinen**
Upstream-Code. Der liegt lokal als git worktree in `upstream/` (gitignored) und kommt per
`scripts/upstream.sh` auf den Stand von `CHATTO_VERSION` – mit allen Patches als Commits.

| Pfad | Inhalt |
|---|---|
| `CHATTO_VERSION` | Upstream-Version, auf die die Patches passen |
| `patches/` | Änderungen am Upstream-Code (`git am`-Format), siehe unten |
| `docker/chatto.Dockerfile` | Baut Upstream-Tag + Patches, legt das Binary über das offizielle Image |
| `.github/workflows/images.yml` | Baut und pusht `ghcr.io/lizzard77/chatto` und `ghcr.io/lizzard77/chatto-pantheon` |
| `bots/pantheon/` | Daggerheart-Würfelbot (läuft auf he1, Image aus GHCR) |
| `bots/erato/` | Musik-Bot (läuft lokal, streamt ins Voice-Call) |
| `tools/update-check/` | Täglicher lokaler Job: neue Upstream-Version → Patches rebasen → Image bauen |
| `scripts/` | Upstream auschecken, bauen, Dev-Server, Patches exportieren |

## Entwickeln

```sh
scripts/upstream.sh            # upstream/ = Tag v$(cat CHATTO_VERSION) + Patches als Commits
scripts/dev.sh                 # bauen und lokalen Server auf http://localhost:4400 starten
scripts/dev.sh --reset         # dasselbe mit frischen Daten (Testuser alice/bob aus upstream/cli/chatto.toml)
scripts/dev.sh --no-build      # nur starten
scripts/build.sh --check       # nur bauen, plus svelte-check
scripts/export-patches.sh      # Commits aus upstream/ nach patches/ zurückschreiben
```

Arbeitsweise: in `upstream/` ändern und committen (ein Commit pro Patch; Korrekturen an einem
bestehenden Patch mit `git commit --fixup <commit>` und `git rebase -i --autosquash v<Version>`),
dann `scripts/export-patches.sh`, hier committen und pushen. Commits als `Phil Reif <pr@sambal.net>`.

Voraussetzungen: git, Go (siehe `upstream/mise.toml`), fnm mit Node 24; pnpm kommt per `npx`.
Für Browser-Tests reicht Playwrights Chromium (`~/.cache/ms-playwright/chromium-*`).

Pantheon gegen den Dev-Server: im Dev-Chatto unter *Server Admin → Bots* einen Bot anlegen, dann
`cd bots/pantheon && npm ci && CHATTO_URL=http://localhost:4400 CHATTO_API_KEY=… node bot.mjs`.

## Images und Deploy

Jeder Push auf `fork`, der `CHATTO_VERSION`, `patches/`, `docker/` oder `bots/pantheon/` ändert,
startet `.github/workflows/images.yml` (auch manuell: `gh workflow run images.yml`):

- `ghcr.io/lizzard77/chatto:<CHATTO_VERSION>` (neuester Build dieser Version) und `…:<Version>-<sha>`
- `ghcr.io/lizzard77/chatto-pantheon:latest` und `…:<sha>`

he1 (`selfhosted-services/he1/chatto/docker-compose.yml`) zieht diese Images:
`docker compose pull chatto pantheon && docker compose up -d chatto pantheon`.
Vor Versionswechseln ein Backup: `docker exec chatto /chatto backup --include-keys -o /backups/<name>.tar.gz`.

## Update auf eine neue Chatto-Version

Erledigt normalerweise `tools/update-check/` (täglich). Von Hand:

```sh
scripts/upstream.sh 0.5.0-beta.13      # Patches mit --3way auf den neuen Tag; Konflikte in upstream/ lösen
CHATTO_VERSION=0.5.0-beta.13 scripts/build.sh --check
scripts/export-patches.sh 0.5.0-beta.13
echo 0.5.0-beta.13 > CHATTO_VERSION    # committen + pushen → Action baut das Image
```

Danach in `selfhosted-services` den Image-Tag in `he1/chatto/docker-compose.yml` anpassen.
Ändert sich das Realtime-/Message-Proto, Pantheons `gen/` neu erzeugen (siehe `bots/pantheon/README.md`).

## Patches

- `0001-iframe-sidebar-links.patch` – Sidebar-Links mit der Option **„In Chatto öffnen“** werden
  im Chatbereich als iframe angezeigt (Route `/chat/<server>/embed/<linkId>`) statt in einem neuen Tab.
  Das Flag steckt als Fragment `#chatto-embed` in der gespeicherten Link-URL, daher braucht der
  Server keine Änderung. Die eingebettete Seite muss Framing erlauben
  (kein `X-Frame-Options: DENY` / passendes `frame-ancestors`).

- `0002-3d-dice.patch` – 3D-Würfel für Würfel-Bots (unabhängig von 0001). Eine Bot-Nachricht mit
  einem Marker-Link wird beim Live-Eintreffen im gerade offenen Raum/Thread als 3D-Wurf über das
  Fenster gerollt; das 🎲 in der Nachricht ist ein Replay-Button. Pro Gerät unter
  **Einstellungen → Darstellung → 3D-Würfel**: *Alle Würfe*, *Nur meine Würfe* oder *Aus*
  (Standard aus bei „Bewegung reduzieren“).
  Eigener WebGL-Renderer ohne Abhängigkeiten (kein Lockfile-Diff), wird erst beim ersten Wurf geladen.
  Hebt das Bundle-Budget der Route `overview` in `apps/frontend/scripts/check-bundle-size.mjs` um 2 KiB an
  (Upstream liegt schon mit 0001 knapp an der Grenze, sonst bricht `pnpm run build` ab).
  Code in `apps/frontend/src/lib/dice/`. Die Upstream-Tests `catalogs.spec.ts` schlagen fehl, weil
  `dice.json` nur für en-GB/de-DE existiert (wie bei 0001) – im Docker-Build laufen sie nicht.

- `0003-image-annotations.patch` – Anmerkungen auf Bildern (unabhängig von 0001/0002). Im
  Vollbild-Viewer jedes Bildes: **nummerierte Pins** (zählen in Reihenfolge hoch) und **Textmarker**,
  jede Person in eigener Farbe (Legende in der Leiste). **Antippen/Klicken** einer Anmerkung zeigt
  einen Auswahlrahmen mit Ankern, **Ziehen** verschiebt sie – mit jedem Werkzeug, alle dürfen alle
  verschieben (Nummer und Farbe bleiben). **Papierkorb** (oder Entf-Taste) löscht die ausgewählte
  Anmerkung – eigene immer, fremde nur mit `message.manage` (Admins im privilegierten Modus).
  „Rückgängig“ nimmt die eigene letzte Anmerkung oder
  Verschiebung zurück, Auge blendet alle aus. Gespeichert wird jede Anmerkung als Antwort im Thread des Bildes
  (`📍 3 [⌖](#chatto-annot:v1:<assetId>:pin:<x>,<y>)`, Textmarker `…:hl:<x>,<y>;…`, Koordinaten
  0…10000 relativ zum Bild; Verschieben: `…:mv:<eventId>:pin:<x>,<y>`, die neueste Verschiebung
  gilt); der Marker-Link wird beim Rendern ausgeblendet, im Thread steht nur
  „📍 3“ bzw. „🖍️“. Live für alle. Im Chatverlauf selbst wird nichts eingeblendet.
  Wird ein Pin gelöscht, rücken die Nummern der späteren Pins nach.
  **Server-Anteil:** Anmerkungs-Antworten lösen kein automatisches Thread-Folgen aus (weder für die
  Person, die anmerkt, noch für die Bild-Autorin), damit es keine Thread-Benachrichtigungen gibt
  (`cli/internal/core/image_annotations.go` + eine Zeile in `messages.go`).

### Würfel-Marker (Schnittstelle Bot ↔ Frontend)

Einzige Kopplung zwischen Bot und Renderer ist dieses Textformat im Nachrichtentext:

```
[🎲](#chatto-dice:<kind>.<sides>.<value>,<kind>.<sides>.<value>,…;by=<userId>)
```

- `;by=<userId>` (optional): Chatto-User-ID des Würfelnden – der Autor der Nachricht ist der Bot.
  Ohne `by` rollt der Wurf bei „Nur meine Würfe“ nicht.

- `kind`: `hope`, `fear` (Daggerheart Duality Dice, gold/violett, beschriftet; beide zusammen
  ergeben das Banner „mit Hoffnung/Furcht/Kritischer Erfolg“), `adv`/`dis` (d6 Vorteil/Nachteil),
  `gm` (GM's Die), `std`, `drop` (verworfener Würfel, grau)
- `sides`: 4, 6, 8, 10, 12, 20, 100 (d100 = Zehner- + Einer-d10); andere Seitenzahlen werden ignoriert
- höchstens 24 Würfel; ungültige Marker bleiben ein normaler (toter) Link

Ohne Patch sieht man nur einen 🎲-Link, ohne Bot passiert nichts – beide Seiten funktionieren allein.
