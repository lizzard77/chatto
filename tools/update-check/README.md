# Täglicher Chatto-Update-Check

Läuft lokal auf Phils PC (systemd-User-Timer, 10:00), nicht in der Cloud.

- `run.sh` – startet `claude -p` mit Opus und `prompt.md` im Repo-Root; Log unter `~/.local/state/chatto-update-check/`
- `prompt.md` – Ablauf: neue Upstream-Version? → DM „neu erschienen“ → Patches rebasen (`scripts/upstream.sh`),
  Build + Typecheck, `CHATTO_VERSION` bumpen, pushen, GitHub-Action abwarten, Image-Tag in
  `selfhosted-services/he1/chatto/docker-compose.yml` bumpen → DM mit Ergebnis. Deploy bleibt manuell.
- `notify.sh` / `notify.js` – DM von Pantheon an Phil (per SSH im `chatto-pantheon`-Container auf he1,
  der Bot-Key bleibt dort). Wiederverwendbar für alles, was Phil benachrichtigen soll.

systemd-Units (`~/.config/systemd/user/`):

```ini
# chatto-update-check.service
[Unit]
Description=Chatto Upstream-Update-Check (Claude Code)
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=/home/phil/p/chatto/tools/update-check/run.sh
TimeoutStartSec=2h

# chatto-update-check.timer
[Unit]
Description=Täglicher Chatto-Update-Check
[Timer]
OnCalendar=*-*-* 10:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

Manuell starten: `systemctl --user start chatto-update-check.service`
