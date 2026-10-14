# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The `fork` branch of `lizzard77/chatto` is a **patch overlay** on [Chatto](https://github.com/chattocorp/chatto), not a fork of its source. It holds no upstream code — only `patches/*.patch` (`git am` format), bots, dev scripts and the image build. `CHATTO_VERSION` pins the upstream tag (`v<version>`) the patches apply to.

Upstream source lives in `upstream/` (gitignored), a **git worktree** on branch `lizzard-patched` = upstream tag + one commit per patch. For anything inside `upstream/` (Go backend in `cli/`, SvelteKit frontend in `apps/frontend/`, protos, upstream tests), follow `upstream/AGENTS.md`.

## Patch workflow

Never edit files in `patches/` by hand. Edit code in `upstream/`, then export:

```sh
scripts/upstream.sh                # (re)create upstream/ = v$(cat CHATTO_VERSION) + patches (git am --3way); refuses if upstream/ is dirty
# edit + commit in upstream/ — one commit per patch; amend an existing patch with
#   git commit --fixup <commit> && git rebase -i --autosquash v<version>
scripts/export-patches.sh          # writes v<version>..HEAD back to patches/, keeping existing NNNN-name.patch filenames
```

Then commit `patches/` in the repo root. Constraint: **each patch must apply on its own and in any order** — the Docker build uses plain `git am` on a fresh clone, no `--3way`.

Rebasing onto a new upstream release: `scripts/upstream.sh <new>` → resolve conflicts in `upstream/` (`git am --continue`) → `CHATTO_VERSION=<new> scripts/build.sh --check` → `scripts/export-patches.sh <new>` → write `<new>` to `CHATTO_VERSION`. If realtime/message protos changed, regenerate `bots/pantheon/gen/` (instructions in `bots/pantheon/README.md`).

## Build and run

```sh
scripts/build.sh            # pnpm install, build frontend (incl. bundle budget), embed it, go build → upstream/cli/bin/chatto
scripts/build.sh --check    # additionally svelte-check (only meaningful after the frontend build)
scripts/dev.sh              # build + run on http://localhost:${CHATTO_DEV_PORT:-4400}, data in .dev/
scripts/dev.sh --no-build   # run only
scripts/dev.sh --reset      # wipe .dev/ → fresh server with test users alice/bob (passwords in upstream/cli/chatto.toml)
```

`scripts/lib.sh` wraps `pnpm`: it runs the version pinned in `upstream/mise.toml` via `npx`, under Node 24 through `fnm` if installed. Go version also comes from `upstream/mise.toml`.

Known expected failures with the patches applied: upstream's `catalogs.spec.ts` (new i18n strings exist only in en-GB and de-DE). Patch 0002 raises the `overview` route budget in `apps/frontend/scripts/check-bundle-size.mjs`; new frontend code close to the budget will fail `pnpm run build`.

## Patches (summary — details in README.md)

- `0001-iframe-sidebar-links` — sidebar links flagged via URL fragment `#chatto-embed` open in an iframe at `/chat/<server>/embed/<linkId>`. Frontend only.
- `0002-3d-dice` — dependency-free WebGL dice renderer in `apps/frontend/src/lib/dice/`, lazy-loaded, triggered by dice marker links in bot messages.
- `0003-image-annotations` — pins/highlighter on images, each annotation stored as a thread reply with a hidden marker link. Server part: `cli/internal/core/image_annotations.go` + one line in `messages.go` (annotation replies don't auto-follow the thread).
- `0004-nachtgold-scheme` — colour scheme of the server branding (`branding/`): surface tone `navy`, accent `gold`, and a `colorSchemes.nachtgold` preset in `userPreferences.svelte.ts` shown in App Preferences → Appearance. Frontend only.

Fork features communicate through **marker links in message bodies** rather than new server APIs, so unpatched clients just see a plain link:
- Dice: `[🎲](#chatto-dice:<kind>.<sides>.<value>,…;by=<userId>)` — the bot ↔ frontend contract; full spec in README.md.
- Annotations: `[⌖](#chatto-annot:v1:<assetId>:pin|hl|mv:…)`, coordinates 0…10000.

## Bots (`bots/`)

Plain Node ESM, no build step, `npm ci` + `node`.

- `pantheon/` — dice bot for Daggerheart, Savage Worlds and plain rolls (`!system dh|swade|raw` per room, `!gm`/`!dm` per user). `bot.mjs` = transport + command dispatch (realtime WebSocket `/api/realtime` in, ConnectRPC-JSON `MessageService/CreateMessage` out, Markdown with `@` escaped); `rolls.mjs` = dice rules returning `{ text, dice, swade }`; `storage.mjs` = `storage/state.json` (gitignored). `gen/` is generated protobuf code (`protoc-gen-es@1.10.1`, realtime proto + imports only) — don't hand-edit. Replies carry the dice marker unless `DICE_3D=false`. Run against the dev server: `CHATTO_URL=http://localhost:4400 CHATTO_API_KEY=… node bot.mjs` (create the bot under Server Admin → Bots).
- `erato/` — runs locally only; joins a voice call via `VoiceCallService/JoinCall` + LiveKit (`@livekit/rtc-node`) and streams a PipeWire/Pulse virtual sink or a file. Needs `ffmpeg` and `pactl`.

## CI / images

`.github/workflows/images.yml` runs on pushes to `fork` touching `CHATTO_VERSION`, `patches/`, `docker/`, `bots/pantheon/` (or `gh workflow run images.yml`). It builds `docker/chatto.Dockerfile` (clone upstream tag → `git am` patches → build frontend + Go binary → copy the binary over the official `ghcr.io/chattocorp/chatto:<version>` image) and the Pantheon image. Tags: `ghcr.io/lizzard77/chatto:<version>` and `:<version>-<sha>`, `ghcr.io/lizzard77/chatto-pantheon:latest` and `:<sha>`. The image build runs no upstream tests.

## tools/update-check

Hermes cron job `chatto-update` in the Hermes backend on the NAS (daily 10:00, setup via `hermes-setup.sh`). Pre-run script `auto-update.sh` does the deterministic path without an LLM: detect new upstream release → `scripts/upstream.sh` → `build.sh --check` → `release.sh` (export, bump `CHATTO_VERSION`, push) → `wait-build.sh` (images.yml) → `bump-compose.sh` (image tag in the separate deployment repo). The agent (skill `skill/SKILL.md`) only writes the report to Bot Chat or resolves conflicts/build failures. One attempt per version (`~/.local/state/chatto-update-check/attempted-<v>`). Deploy stays manual.

## tools/notify.sh

`tools/notify.sh "Markdown"` (or stdin) sends Phil a Chatto DM from the Hermes bot (room `b2f2f66a32d348`, override with `CHATTO_NOTIFY_ROOM`). Works inside the Hermes container directly, elsewhere via `ssh nas` + `docker exec hermes`; the bot token stays in the container. Use it for notifications instead of Pantheon (Pantheon is user-facing).

## Conventions

- Talk to the user in German. Scripts, comments and bot READMEs are written in German; the top-level README is English.
- Publishing a new version = commit directly on `fork` (the repo's default branch) and `git push origin fork`; the push triggers the image build. No feature branches or PRs. Do not commit to `main` — it only mirrors upstream `chattocorp/chatto`.
