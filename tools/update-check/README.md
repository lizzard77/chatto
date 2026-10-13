# Täglicher Chatto-Update-Check

Läuft als Hermes-Cron-Job `chatto-update` im Hermes-Backend auf dem nas (täglich 10:00), Nachricht ins
Bot Chat. Deploy bleibt manuell.

- `auto-update.sh` – Pre-run-Skript, macht den Normalfall komplett ohne LLM: neue Upstream-Version? →
  `scripts/upstream.sh` → `scripts/build.sh --check` → `release.sh` → `wait-build.sh` → `bump-compose.sh`.
  Ohne neue Version gibt es `{"wakeAgent": false}` aus (kein Agent-Lauf, keine Nachricht), sonst einen Bericht
  (`STATUS: done | conflict | build-failed | …`), mit dem der Agent die Nachricht schreibt oder Konflikte löst.
  Pro Version nur ein Versuch; erneut: `~/.local/state/chatto-update-check/attempted-<Version>` löschen.
  Log: `~/.local/state/chatto-update-check/<Version>.log`.
- `release.sh <v>` – patches/ exportieren, `CHATTO_VERSION` setzen, committen, pushen (startet die Image-Action)
- `wait-build.sh <sha> [s]` – wartet auf `images.yml` (öffentliche GitHub-API); Exit 2 = läuft noch
- `bump-compose.sh <v>` – Image-Tag in `selfhosted-services/he1/chatto/docker-compose.yml`, commit + push
- `skill/SKILL.md` – Hermes-Skill `chatto-update`: was der Agent je nach `STATUS` tut

Die Skripte laufen auch lokal (`tools/update-check/auto-update.sh` im Repo-Root eines sauberen `fork`-Checkouts).

## Einrichtung im Hermes-Container (nas)

HERMES_HOME = `/opt/data` (= `/mnt/user/appdata/hermes/data` auf dem nas). Go kommt aus dem Hermes-Dockerfile
(`selfhosted-services/nas/hermes`), Node/npx aus dem Basis-Image.

Alles Weitere macht `hermes-setup.sh` (idempotent): Deploy-Keys je Repo (`~/.ssh/gh_chatto`,
`~/.ssh/gh_selfhosted`, Hosts `github-chatto`/`github-selfhosted`), Klone in `~/workspace/chatto` und
`~/workspace/selfhosted-services`, Skill-Link `~/skills/devops/chatto-update`, Pre-run-Skript
`~/scripts/chatto-update.sh` und der Cron-Job (`0 10 * * *`, `--workdir ~/workspace/chatto`, `--deliver bot-chat:default`).

    curl -fsSL https://raw.githubusercontent.com/lizzard77/chatto/fork/tools/update-check/hermes-setup.sh \
      | docker exec -i -u hermes hermes bash

Der erste Lauf bricht ab und zeigt die `gh repo deploy-key add …`-Befehle für die neuen Keys; danach erneut ausführen.
