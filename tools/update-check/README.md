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
- `notify.sh` / `notify.js` – DM von Pantheon an Phil (per SSH im `chatto-pantheon`-Container auf he1);
  vom Job nicht mehr benutzt, aber wiederverwendbar

Die Skripte laufen auch lokal (`tools/update-check/auto-update.sh` im Repo-Root eines sauberen `fork`-Checkouts).

## Einrichtung im Hermes-Container (nas)

HERMES_HOME = `/opt/data` (= `/mnt/user/appdata/hermes/data` auf dem nas). Go kommt aus dem Hermes-Dockerfile
(`selfhosted-services/nas/hermes`), Node/npx aus dem Basis-Image.

1. Deploy-Keys (je Repo einer, GitHub erlaubt keinen Key in zwei Repos): `~/.ssh/gh_chatto` mit Schreibrecht
   auf `lizzard77/chatto`, `~/.ssh/gh_selfhosted` mit Schreibrecht auf `lizzard77/selfhosted-services`;
   in `~/.ssh/config` als `Host github-chatto` / `Host github-selfhosted` (HostName github.com, IdentitiesOnly).
2. Klone in `~/workspace/`:

       git clone -b fork github-chatto:lizzard77/chatto.git ~/workspace/chatto
       git clone github-selfhosted:lizzard77/selfhosted-services.git ~/workspace/selfhosted-services
       # in beiden: git config user.name "Phil Reif"; git config user.email pr@sambal.net

3. Skill und Skript verlinken:

       ln -s ~/workspace/chatto/tools/update-check/skill ~/skills/devops/chatto-update
       printf '#!/usr/bin/env bash\nexport HOME=/opt/data\nexec /opt/data/workspace/chatto/tools/update-check/auto-update.sh\n' \
         > ~/scripts/chatto-update.sh && chmod +x ~/scripts/chatto-update.sh

4. Job:

       hermes cron create "0 10 * * *" "Chatto-Update-Check: Bericht des Pre-run-Skripts auswerten (Skill chatto-update)." \
         --name chatto-update --skill chatto-update --script chatto-update.sh \
         --workdir /opt/data/workspace/chatto --deliver bot-chat:default
