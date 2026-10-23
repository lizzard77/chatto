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
scripts/build.sh            # pnpm install, build frontend, embed it, go build → upstream/cli/bin/chatto
scripts/build.sh --check    # additionally svelte-check (only meaningful after the frontend build)
scripts/dev.sh              # build + run on http://localhost:${CHATTO_DEV_PORT:-4400}, data in .dev/
scripts/dev.sh --no-build   # run only
scripts/dev.sh --reset      # wipe .dev/ → fresh server with test users alice/bob (passwords in upstream/cli/chatto.toml)
```

`scripts/lib.sh` wraps `pnpm`: it runs the version pinned in `upstream/mise.toml` via `npx`, under Node 24 through `fnm` if installed. Go version also comes from `upstream/mise.toml`.

Known expected failures with the patches applied: upstream's `catalogs.spec.ts` (new i18n strings exist only in en-GB and de-DE). Upstream removed its bundle budget check in 0.5.0-beta.16. Also failing: two Slow-Mode/Markdown-editor tests in `MessageComposer.svelte.spec.ts` (fail upstream too) and `appearance.page.svelte.spec.ts` (panel count, from 0002).

## Patches (summary — details in README.md)

- `0001-iframe-sidebar-links` — sidebar links flagged via URL fragment `#chatto-embed` open in an iframe at `/chat/<server>/embed/<linkId>`. Frontend only.
- `0002-3d-dice` — dependency-free WebGL dice renderer in `apps/frontend/src/lib/dice/`, lazy-loaded, triggered by dice marker links in bot messages (the room pane also throws the rolls of its threads, e.g. the dice thread).
- `0003-image-annotations` — pins/highlighter on images, each annotation stored as a thread reply with a hidden marker link. Server part: `cli/internal/core/image_annotations.go` + one line in `messages.go`: "quiet" thread replies don't auto-follow the thread — annotation replies, dice bot replies (`#chatto-dice…` markers) and `!…` bot commands, so dice threads cause no notifications unless someone follows them on purpose.
- `0004-nachtgold-scheme` — colour scheme of the server branding (`branding/`): surface tone `navy`, accent `gold`, and a `colorSchemes.nachtgold` preset in `userPreferences.svelte.ts` shown in App Preferences → Appearance. Frontend only.

- `0005-room-links` — `#name` autocomplete in the composer inserts a plain room link; rendered room links become chips with the current room name, or "unknown room" without access; room links to the same server get no link preview in the composer. Code in `apps/frontend/src/lib/roomLinks.ts`. Frontend only.
- `0006-dice-tray` — composer 🎲 button with a flyout (d4–d100, modifier, duality) that posts `!r …` for Pantheon, plus a results card above the room composer (latest roll; per player for GMs, detected from `;gm=1` on the viewer's own rolls). Opens empty; SWADE rooms get a "With Wild Die" toggle (`!r wild|extra d8`), Daggerheart rooms a disadvantage/normal/advantage switch for the duality roll (`!r adv|dis`); a typed `!r …` that the tray can show opens the tray prefilled instead of posting (macros, `kh`, `dmg` still post). Code in `apps/frontend/src/lib/diceTray/`. Frontend only.
- `0007-tombstone-backfill` — upstream fix in `EventList.svelte`: a room whose newest page is only deleted messages kept backfilling after a reload (race with the in-flight flag). Frontend only.
- `0008-deleted-threads` — upstream fix: deleted thread roots whose replies are all deleted vanish (room timeline re-reads the reply count of deleted roots after a retraction; Threads page omits them). Code in `@chatto/client` and the Threads page.
- `0009-call-featured-once` — upstream fix in `VoiceCallPanel.svelte`: in the sidebar call layout the featured participant no longer appears a second time (as a stretched, empty compact card) in the participant list. Frontend only.

Fork features communicate through **marker links in message bodies** rather than new server APIs, so unpatched clients just see a plain link:
- Dice: `[🎲](#chatto-dice:<kind>.<sides>.<value>,…;by=<userId>)` — the bot ↔ frontend contract; full spec in README.md.
- Annotations: `[⌖](#chatto-annot:v1:<assetId>:pin|hl|mv:…)`, coordinates 0…10000.
- Room links: ordinary links to `/chat/<server>/<roomId>`; no marker needed.

## Bots (`bots/`)

Plain Node ESM, no build step, `npm ci` + `node`.

- `pantheon/` — dice bot for Daggerheart, Savage Worlds and plain rolls (`!system dh|swade|raw` per room, `!gm`/`!dm` per user, `!dice` in a thread = the room's dice thread that all rolls go to, `!purge` (GM only) deletes all `!…` messages, all bot messages, the dice thread with its root and the remaining replies of threads whose root is deleted). `bot.mjs` = transport + command dispatch (realtime WebSocket `/api/realtime` in, ConnectRPC-JSON `MessageService/CreateMessage` out, Markdown with `@` escaped); `rolls.mjs` = dice rules returning `{ text, dice, swade }`; `initiative.mjs` = SWADE action deck for `!ini` (state per room); `storage.mjs` = `storage/state.json` (gitignored). `gen/` is generated protobuf code (`protoc-gen-es@1.10.1`, realtime proto + imports only) — don't hand-edit. Replies carry the dice marker unless `DICE_3D=false`. With `DELETE_COMMANDS` (default on) the bot deletes the `!…` command after replying and prefixes the reply with the sender's display name (needs `message.manage`). Run against the dev server: `CHATTO_URL=http://localhost:4400 CHATTO_API_KEY=… node bot.mjs` (create the bot under Server Admin → Bots).
- `erato/` — runs locally only; asks for the channel at start (one instance per PC and channel, the control socket `$XDG_RUNTIME_DIR/erato-<roomId>.sock` is the lock), joins its call via `VoiceCallService/JoinCall` + LiveKit (`@livekit/rtc-node`) and streams a PipeWire/Pulse virtual sink or a file. `share` (console or `node erato.mjs ctl share`) sends a desktop window as Erato's screen-share track (camera with `ERATO_VIDEO_AS=camera`; Chatto crops camera tiles): `share.mjs` picks the backend, on Wayland `share-portal.mjs` does the ScreenCast portal via `dbus-next` (no Python) and runs `gst-launch-1.0` with `pipewiresrc target-object=<object.serial>` (no portal fd needed); it computes scaling/borders itself (pipewiresrc reports a bogus pixel aspect ratio) and restarts gst-launch when the window size changes (polled via `pw-dump`), elsewhere ffmpeg. Commands also via Chatto DM from `ERATO_DM_USERS` (polls DM rooms with `RoomService/GetRoomEvents`, no realtime/protobuf; with several instances on one PC only the addressed one answers). Needs `ffmpeg` and `pactl`; one bot account per GM.

## CI / images

`.github/workflows/images.yml` runs on pushes to `fork` touching `CHATTO_VERSION`, `patches/`, `docker/`, `bots/pantheon/` (or `gh workflow run images.yml`). It builds `docker/chatto.Dockerfile` (clone upstream tag → `git am` patches → build frontend + Go binary → copy the binary over the official `ghcr.io/chattocorp/chatto:<version>` image) and the Pantheon image. Tags: `ghcr.io/lizzard77/chatto:<version>` and `:<version>-<sha>`, `ghcr.io/lizzard77/chatto-pantheon:latest` and `:<sha>`. The image build runs no upstream tests.

## tools/update-check

Hermes cron job `chatto-update` in the Hermes backend on the NAS (daily 10:00, setup via `hermes-setup.sh`). Pre-run script `auto-update.sh` does the deterministic path without an LLM: detect new upstream release → `scripts/upstream.sh` → `build.sh --check` → `release.sh` (export, bump `CHATTO_VERSION`, push) → `wait-build.sh` (images.yml) → `bump-compose.sh` (image tag in the separate deployment repo). The agent (skill `skill/SKILL.md`) only writes the report to Bot Chat or resolves conflicts/build failures. One attempt per version (`~/.local/state/chatto-update-check/attempted-<v>`). Deploy stays manual.

## tools/notify.sh

`tools/notify.sh "Markdown"` (or stdin) sends Phil a Chatto DM from the Hermes bot (room `b2f2f66a32d348`, override with `CHATTO_NOTIFY_ROOM`). Works inside the Hermes container directly, elsewhere via `ssh nas` + `docker exec hermes`; the bot token stays in the container. Use it for notifications instead of Pantheon (Pantheon is user-facing).

## Conventions

- Talk to the user in German. Scripts, comments and bot READMEs are written in German; the top-level README is English.
- Publishing a new version = commit directly on `fork` (the repo's default branch) and `git push origin fork`; the push triggers the image build. No feature branches or PRs. Do not commit to `main` — it only mirrors upstream `chattocorp/chatto`.
