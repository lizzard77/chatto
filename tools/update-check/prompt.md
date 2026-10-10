# Täglicher Chatto-Update-Check (headless, läuft per systemd-Timer auf Phils PC)

Du arbeitest im Repo `~/p/chatto` (aktuelles Verzeichnis), Branch `fork` – Phils Chatto-Fork:
Patches in `patches/`, Bots in `bots/`, Skripte in `scripts/`, GitHub-Action `.github/workflows/images.yml`
baut daraus `ghcr.io/lizzard77/chatto:<Version>` und `ghcr.io/lizzard77/chatto-pantheon`.
Der Upstream-Quellcode liegt als git worktree in `upstream/` (gitignored).

Niemand sieht dir live zu – alle Rückmeldungen an Phil gehen über `tools/update-check/notify.sh`
(Markdown auf stdin, z. B. `tools/update-check/notify.sh <<< "Text"`), das eine Chatto-DM aufs Handy
schickt. Nachrichten an Phil auf Deutsch, kurz. Commits immer als `Phil Reif <pr@sambal.net>`.

## 1. Prüfen

1. Aktuelle Version: Datei `CHATTO_VERSION`.
2. Upstream-Tags: `git ls-remote --tags https://github.com/chattocorp/chatto.git`. Relevant sind
   Release-Tags `vX.Y.Z` und `vX.Y.Z-beta.N` / `-rc.N` (keine `^{}`-Einträge, keine alpha).
   Bestimme den neuesten nach SemVer (stabil > rc > beta bei gleicher X.Y.Z; `sort -V` sortiert
   `v0.5.0` fälschlich vor die Betas – vergleiche selbst).
3. Ist nichts neuer als die aktuelle Version: **sofort beenden, keine Nachricht.**

## 2. Neue Version gefunden

1. Erste Nachricht: `🔔 Chatto <neue Version> ist erschienen (aktuell <alt>). Ich passe die Fork-Patches an …`
   plus 3–6 Stichpunkte aus dem CHANGELOG.md des neuen Tags (Abschnitte zwischen alter und neuer
   Version, Breaking Changes zuerst).
2. Vorbedingungen: `git status` sauber, Branch `fork`, `git pull --ff-only` erfolgreich. Sonst
   abbrechen und melden (`⚠️ …`), nichts ändern.

## 3. Patches rebasen und prüfen

1. `scripts/upstream.sh <neue Version>` – checkt den neuen Tag in `upstream/` aus und wendet die
   Patches mit `git am --3way` an. Bei Konflikten in `upstream/` lösen (`git am --continue`).
   Was die Patches tun, steht in `README.md` (Abschnitt Patches): iframe-Sidebar-Links, 3D-Würfel,
   Bild-Anmerkungen (inkl. kleiner Server-Änderung in `cli/internal/core`). Upstream-Änderungen
   übernehmen, unseren Teil obendrauf. Bei JSON-Konflikten in `apps/frontend/messages/`: Upstream-
   Version nehmen und unsere Keys per Skript ergänzen.
2. `CHATTO_VERSION=<neue Version> scripts/build.sh --check` – Ziel: Build grün (inkl. Bundle-Budget
   in `apps/frontend/scripts/check-bundle-size.mjs`) und svelte-check **0 ERRORS**, Go-Build ok.
   Fehler in unseren Dateien beheben und in `upstream/` als `git commit --fixup <Patch-Commit>`
   committen, dann `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash v<neu>` (kein Editor nötig). Schlägt nur das
   Bundle-Budget knapp fehl: Budget im 3D-Würfel-Patch (overview) um 1–2 KiB anheben.
3. Klappt das nicht mit vertretbarem Aufwand: nichts pushen, Nachricht `❌ Patches für <Version>
   nicht automatisch anpassbar: <Grund, betroffene Dateien>` und beenden.

## 4. Übernehmen

1. `scripts/export-patches.sh <neue Version>` schreibt die Commits nach `patches/` zurück.
2. `CHATTO_VERSION` auf die neue Version setzen.
3. Pantheon-Bot: `git -C upstream diff v<alt> v<neu> --stat -- proto/chatto/realtime proto/chatto/api/v1/messages.proto proto/chatto/api/v1/viewer.proto`.
   Bei Änderungen in der Abschlussnachricht deutlich darauf hinweisen (Bindings in
   `bots/pantheon/gen/` neu erzeugen, siehe `bots/pantheon/README.md`) – nicht selbst machen.
4. Commit auf `fork` mit Message `Chatto <v>, rebase patches` und dem Trailer
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   ```
   dann `git push`. Die GitHub-Action baut daraus `ghcr.io/lizzard77/chatto:<v>`.
5. Warte auf den Action-Lauf: `gh run list --workflow images.yml -L 1` / `gh run watch <id> --exit-status`
   (bis 45 min). Schlägt er fehl: Fehler aus `gh run view <id> --log-failed` melden und beenden.
6. Selfhosted-Repo `~/p/selfhosted-services`: in `he1/chatto/docker-compose.yml` das Image auf
   `ghcr.io/lizzard77/chatto:<v>` setzen, committen (`Chatto <v>`, gleicher Trailer), auf `main` pushen.
7. **Nicht deployen** (kein `docker compose` auf he1).

## 5. Abschlussnachricht

`✅ Chatto <v>: Patches angepasst, Build + Typecheck grün, Image gebaut (<kurzer Commit-Hash>).`
+ was an Konflikten gelöst wurde (1–3 Stichpunkte) + ggf. Pantheon-Hinweis
+ Zeile: `Deploy: auf he1 in he1/chatto → docker compose pull chatto && docker compose up -d chatto`
