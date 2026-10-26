---
name: chatto-update
description: "Daily Chatto fork update check: report on (or finish) rebasing the lizzard77/chatto patch overlay onto a new upstream release."
version: 1.0.0
author: Phil Reif
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [chatto, git, release, cron]
---
# Chatto-Update (Fork lizzard77/chatto)

Repo: `~/workspace/chatto` (Branch `fork`), ein Patch-Overlay auf Upstream `chattocorp/chatto`.
Was die Patches tun und wie der Patch-Workflow geht, steht in `CLAUDE.md` und `README.md` im Repo – lies
`CLAUDE.md`, bevor du etwas in `upstream/` änderst. Das Deployment-Repo liegt in `~/workspace/selfhosted-services`.

Das Pre-run-Skript `tools/update-check/auto-update.sh` hat schon alles Deterministische versucht. Sein
Bericht steht im Kontext: `STATUS`, `OLD`, `NEW`, `LOG` (vollständiges Log) und Details.
Deine Antwort ist die Nachricht an Phil: Deutsch, kurz, Markdown. Commits immer als `Phil Reif <pr@sambal.net>`.

## STATUS: done

Alles erledigt. Schreib nur die Nachricht:

`✅ Chatto <NEW>: Patches angepasst, Build + Typecheck grün, Image gebaut (<COMMIT>), Compose-Tag gesetzt.`
- 3–5 Stichpunkte aus `upstream/CHANGELOG.md` für die Versionen nach `OLD` bis `NEW` (Breaking Changes zuerst).
- Was sich an den Patches inhaltlich geändert hat (`PATCH_DIFF`; z. B. angehobenes Bundle-Budget), sonst „Patches unverändert“.
- Ist `PROTO_DIFF` nicht „keine“: deutlicher Hinweis, dass Pantheon und Erato evtl. ein neueres
  `@chatto/client` brauchen (`bots/pantheon/README.md`, Abschnitt Chatto-Update) – nicht selbst machen.
- Letzte Zeile: `Deploy: auf he1 in he1/chatto → docker compose pull chatto && docker compose up -d chatto`

## STATUS: conflict oder build-failed

Versuch es zu reparieren, mit vertretbarem Aufwand:

1. `conflict`: `git am` steht in `upstream/`. Konflikte lösen (Upstream-Änderungen übernehmen, unseren Teil
   obendrauf), `git -C upstream am --continue`, bis alle Patches angewendet sind. Bei JSON-Konflikten in
   `apps/frontend/messages/`: Upstream-Version nehmen und unsere Keys per Skript ergänzen.
   Die Bugfix-Patches 0007/0008 sind upstream gemeldet: Hat upstream den Fehler selbst behoben (Konflikt
   an derselben Stelle, oder der Patch ist leer), den Patch mit `git -C upstream am --skip` fallen lassen und
   ihn in CLAUDE.md und README.md streichen; im Bericht erwähnen.
2. `CHATTO_VERSION=<NEW> scripts/build.sh --check` (dauert einige Minuten; mit langem Timeout bzw. im
   Hintergrund laufen lassen und auf das Ende warten). `build.sh` setzt ohne TTY selbst `CI=true`, das braucht pnpm 10+. Ziel: Build grün inkl. Bundle-Budget, svelte-check 0 Errors.
   Fehler in unseren Dateien beheben, in `upstream/` als `git commit --fixup <Patch-Commit>` committen, dann
   `GIT_SEQUENCE_EDITOR=: git -C upstream rebase -i --autosquash v<NEW>`. Scheitert nur das Bundle-Budget knapp:
   Budget im 3D-Würfel-Patch (`apps/frontend/scripts/check-bundle-size.mjs`) um 1–2 KiB anheben.
3. Grün: `tools/update-check/release.sh <NEW>` (export, `CHATTO_VERSION`, Commit, Push), dann
   `tools/update-check/wait-build.sh <neuer HEAD-SHA>` – Exit 2 heißt „läuft noch“, erneut aufrufen (max. 45 min
   insgesamt), Exit 1 = Image-Build fehlgeschlagen. Bei Erfolg `tools/update-check/bump-compose.sh <NEW>`.
   Dann die Nachricht wie bei `done`, plus 1–3 Stichpunkte, was du gelöst hast.
4. Klappt das nicht: nichts pushen, `upstream/` so lassen und antworten mit
   `❌ Patches für <NEW> nicht automatisch anpassbar: <Grund, betroffene Dateien>`.

## Andere STATUS-Werte

- `action-pending`: `tools/update-check/wait-build.sh <SHA>` erneut aufrufen (wie oben), danach `bump-compose.sh`.
- `action-failed`: Fehler über `https://github.com/lizzard77/chatto/actions` bzw. die Run-URL im Bericht
  zusammenfassen, nichts weiter tun.
- `precondition-failed`, `push-failed`, `compose-failed`: nichts reparieren, `⚠️ Chatto <NEW>: …` mit dem Grund melden.

Zugang he1 (nur auf ausdrückliche Bitte von Phil nutzen): `ssh -i /opt/data/.ssh/id_ed25519 phil@he1.lizzard77.dev`,
Compose unter `~/selfhosted-services/he1/chatto` (vorher `git pull --ff-only`).

Im Cron-Lauf nie deployen (kein `docker compose` auf he1), nie force-pushen, nie auf `main` des Chatto-Repos committen.
Ein neuer automatischer Versuch für dieselbe Version passiert erst, wenn die Datei
`~/.local/state/chatto-update-check/attempted-<NEW>` gelöscht wird – erwähne das bei `❌`/`⚠️`.
