#!/usr/bin/env bash
# Richtet den Chatto-Update-Check im Hermes-Container ein (idempotent, mehrfach ausführbar).
# Auf dem nas:
#   curl -fsSL https://raw.githubusercontent.com/lizzard77/chatto/fork/tools/update-check/hermes-setup.sh \
#     | docker exec -i -u hermes hermes bash
# Erster Lauf erzeugt die Deploy-Keys und bricht ab, bis sie auf GitHub eingetragen sind.
set -euo pipefail
export HOME=/opt/data
W=$HOME/workspace

# 1. Deploy-Keys + SSH-Config
mkdir -p ~/.ssh && chmod 700 ~/.ssh && cd ~/.ssh
for n in chatto selfhosted; do
  [ -f gh_$n ] || ssh-keygen -q -t ed25519 -N "" -C "hermes@nas deploy $n" -f gh_$n
done
grep -q '^github.com ssh-ed25519' known_hosts 2>/dev/null || ssh-keyscan -t ed25519 github.com >> known_hosts 2>/dev/null
grep -q '^Host github-chatto' config 2>/dev/null || cat >> config <<'EOF'

# Deploy-Keys (Chatto-Update-Check)
Host github-chatto
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_chatto
  IdentitiesOnly yes
Host github-selfhosted
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_selfhosted
  IdentitiesOnly yes
EOF
ok=1
for n in chatto selfhosted; do
  ssh -o BatchMode=yes -T github-$n 2>&1 | grep -q 'successfully authenticated' || { ok=0
    echo "!! Deploy-Key gh_$n fehlt auf GitHub. Lokal eintragen (mit Schreibrecht):"
    repo=$([ $n = chatto ] && echo chatto || echo selfhosted-services)
    echo "   echo '$(cat gh_$n.pub)' > /tmp/gh_$n.pub && gh repo deploy-key add /tmp/gh_$n.pub -R lizzard77/$repo -w -t hermes-nas"; }
done
[ $ok = 1 ] || { echo "Danach dieses Skript erneut ausführen."; exit 1; }

# 2. Klone
mkdir -p "$W"
[ -d "$W/chatto/.git" ] || git clone -q -b fork github-chatto:lizzard77/chatto.git "$W/chatto"
[ -d "$W/selfhosted-services/.git" ] || git clone -q github-selfhosted:lizzard77/selfhosted-services.git "$W/selfhosted-services"
for r in chatto selfhosted-services; do
  git -C "$W/$r" config user.name "Phil Reif"; git -C "$W/$r" config user.email pr@sambal.net
done

# 3. Skill + Pre-run-Skript
mkdir -p ~/skills/devops ~/scripts
ln -sfn "$W/chatto/tools/update-check/skill" ~/skills/devops/chatto-update
printf '#!/usr/bin/env bash\n# Pre-run-Skript des Cron-Jobs chatto-update (siehe ~/workspace/chatto/tools/update-check/README.md)\nexport HOME=/opt/data\nexec /opt/data/workspace/chatto/tools/update-check/auto-update.sh\n' > ~/scripts/chatto-update.sh
chmod +x ~/scripts/chatto-update.sh

# 4. Toolchain prüfen
go version; node --version

# 5. Cron-Job
if hermes cron list 2>/dev/null | grep -q 'Name: *chatto-update$'; then
  echo "Cron-Job chatto-update existiert schon."
else
  hermes cron create "0 10 * * *" \
    "Chatto-Update-Check: Bericht des Pre-run-Skripts (STATUS, OLD, NEW, …) nach Skill chatto-update auswerten und Phil die Nachricht schreiben." \
    --name chatto-update --skill chatto-update --script chatto-update.sh \
    --workdir "$W/chatto" --deliver bot-chat:default
fi
echo "== fertig. Testlauf: hermes cron run <id>  (Log: ~/.local/state/chatto-update-check/)"
