# Chatto – Lizzard fork

Extensions for [Chatto](https://github.com/chattocorp/chatto): patches on top of the upstream code,
bots, a local development setup and the GitHub Action that builds the container images.

This branch (`fork`, the default branch of `lizzard77/chatto`) contains **no** upstream code. Upstream
is checked out locally as a git worktree in `upstream/` (gitignored); `scripts/upstream.sh` brings it
to the version in `CHATTO_VERSION` with all patches applied as commits.

| Path | Contents |
|---|---|
| `CHATTO_VERSION` | Upstream version the patches apply to |
| `patches/` | Changes to the upstream code (`git am` format), see below |
| `docker/chatto.Dockerfile` | Builds the upstream tag plus patches and puts the binary on top of the official image |
| `.github/workflows/images.yml` | Builds and pushes `ghcr.io/lizzard77/chatto` and `ghcr.io/lizzard77/chatto-pantheon` |
| `bots/pantheon/` | Dice bot for Daggerheart and Savage Worlds (container image from GHCR) |
| `bots/erato/` | Music bot that streams a local audio source into a voice call |
| `tools/update-check/` | Optional daily job: new upstream release → rebase patches → build image |
| `scripts/` | Check out upstream, build, run a dev server, export patches |

## Development

```sh
scripts/upstream.sh            # upstream/ = tag v$(cat CHATTO_VERSION) + patches as commits
scripts/dev.sh                 # build and start a local server on http://localhost:4400
scripts/dev.sh --reset         # same with fresh data (test users alice/bob from upstream/cli/chatto.toml)
scripts/dev.sh --no-build      # start only
scripts/build.sh --check       # build only, plus svelte-check
scripts/export-patches.sh      # write the commits in upstream/ back to patches/
```

Workflow: change and commit in `upstream/` (one commit per patch; fix an existing patch with
`git commit --fixup <commit>` and `git rebase -i --autosquash v<version>`), then run
`scripts/export-patches.sh`, commit here and push.

Requirements: git, Go (version in `upstream/mise.toml`), Node 24 (used through `fnm` when installed);
pnpm is fetched with `npx`. The dev server listens on `CHATTO_DEV_PORT` (default 4400) and keeps its
data in `.dev/`.

Running Pantheon against the dev server: create a bot under *Server Admin → Bots* in the dev
instance, then
`cd bots/pantheon && npm ci && CHATTO_URL=http://localhost:4400 CHATTO_API_KEY=… node bot.mjs`.

## Images and deployment

Every push to `fork` that changes `CHATTO_VERSION`, `patches/`, `docker/` or `bots/pantheon/` runs
`.github/workflows/images.yml` (also manually: `gh workflow run images.yml`):

- `ghcr.io/lizzard77/chatto:<CHATTO_VERSION>` (latest build of that version) and `…:<version>-<sha>`
- `ghcr.io/lizzard77/chatto-pantheon:latest` and `…:<sha>`

Use them in place of the official image, for example in Docker Compose:

```yaml
services:
  chatto:
    image: ghcr.io/lizzard77/chatto:0.5.0-beta.12
  pantheon:
    image: ghcr.io/lizzard77/chatto-pantheon:latest
```

Update with `docker compose pull && docker compose up -d`. Take a backup before changing versions:
`docker exec chatto /chatto backup --include-keys -o /backups/<name>.tar.gz`.

## Updating to a new Chatto release

`tools/update-check/` can do this automatically. By hand:

```sh
scripts/upstream.sh 0.5.0-beta.13      # apply the patches with --3way to the new tag; resolve conflicts in upstream/
CHATTO_VERSION=0.5.0-beta.13 scripts/build.sh --check
scripts/export-patches.sh 0.5.0-beta.13
echo 0.5.0-beta.13 > CHATTO_VERSION    # commit + push → the action builds the image
```

Then point your deployment at the new image tag. If the realtime or message protos changed,
regenerate Pantheon's `gen/` (see `bots/pantheon/README.md`).

## Patches

Each patch applies on its own and in any order (the image build uses plain `git am`).

- `0001-iframe-sidebar-links.patch` – sidebar links with the **"Open in Chatto"** option open as an
  iframe in the chat area (route `/chat/<server>/embed/<linkId>`) instead of a new tab. The flag is
  stored as the fragment `#chatto-embed` in the saved link URL, so the server needs no change. The
  embedded site must allow framing (no `X-Frame-Options: DENY`, a matching `frame-ancestors`).

- `0002-3d-dice.patch` – 3D dice for dice bots (Daggerheart and Savage Worlds). When a bot message with a dice marker link arrives
  live in the open room or thread, the dice tumble across the window; the 🎲 in the message replays
  the roll. Per device under **Settings → Appearance → 3D dice**: *All rolls*, *Only my rolls* or
  *Off* (off by default with "reduce motion"). Own dependency-free WebGL renderer, loaded on the
  first roll only (no lockfile change). Code in `apps/frontend/src/lib/dice/`. Upstream's
  `catalogs.spec.ts` fails because the new strings exist only in en-GB and de-DE (as with 0001);
  the image build does not run it.

- `0003-image-annotations.patch` – annotations on images. In the full-screen viewer of any image:
  **numbered pins** (counting up in posting order) and a **highlighter**, each participant in their
  own colour (legend in the toolbar). **Tap/click** an annotation to select it (bounding box with
  anchors), **drag** to move it – with any tool; everyone may move every annotation, number and
  colour stay. The **trash** button (or the Delete key) removes the selected annotation – your own
  always, others' only with `message.manage`. **Undo** takes back your last annotation or move, the
  eye hides all annotations. Each annotation is a reply in the image's thread
  (`📍 3 [⌖](#chatto-annot:v1:<assetId>:pin:<x>,<y>)`, highlighter `…:hl:<x>,<y>;…`, coordinates
  0…10000 relative to the image; moves: `…:mv:<eventId>:pin:<x>,<y>`, the latest move wins). The
  marker link is hidden when rendering, so the thread shows only "📍 3" or "🖍️". Live for everyone;
  the chat timeline itself shows nothing extra. Deleting a pin renumbers the later pins.
  **Server part:** annotation replies do not auto-follow the thread (neither for the annotator nor
  for the image's author), so they cause no thread notifications
  (`cli/internal/core/image_annotations.go` plus one line in `messages.go`).

- `0004-nachtgold-scheme.patch` – the **Nachtgold** colour scheme of the Rollenspiel server
  (`branding/`): a new surface tone **Navy** (hue 250, chroma 0.075), a new accent colour **Gold**
  (`oklch(50% 0.105 78)` / `oklch(83% 0.14 85)`), and a one-click preset under **Settings →
  Appearance → Theme customisation → Colour scheme** that sets the dark theme, the gold accent and the
  navy tone for both themes. The choice stays per browser like every appearance setting; Chatto has
  no server-wide default. Frontend only, strings in en-GB and de-DE (as with 0001/0002). Upstream's
  appearance page spec expects 3 panels and already fails with 0002 (dice panel); 0004 adds none.

- `0005-room-links.patch` – links to rooms. Typing `#` plus at least one character in the composer
  offers the server's rooms (joined rooms rank first among equal matches); Enter/Tab inserts a
  normal Markdown link `[#name](<origin>/chat/<server>/<roomId>)`, so unpatched clients and bots
  see a working link. Rendered links to a room show as a chip with the **current** room name if
  the label is generated (`#…` or the bare URL); custom labels stay. Links to rooms the viewer
  cannot see (private without access, deleted, archived) become a non-clickable **"unknown room"**
  chip, so the room name in the label does not leak. DMs, threads, messages and other servers stay
  plain links. Code in `apps/frontend/src/lib/roomLinks.ts`. Frontend only.

- `0006-dice-tray.patch` – dice tray. A 🎲 button next to the attachment button in the composer
  opens a flyout: pick d4–d100 (right-click removes a die), a modifier, then **Roll**, or
  **2d12** (duality dice) in the die grid – shown only while the room's system is Daggerheart, as
  the bot last reported it (`;sys=` or the system marker; `dh` before any report). The trash
  button clears the pick. The tray posts a plain `!r 2d6+1` for the dice bot, into the
  room's dice thread once it knows it. A small card above the room composer shows the latest
  result; a viewer whose own latest roll was a GM roll (`;gm=1` in the dice marker) sees the
  latest result per player instead. The card follows live events, thread replies included, and
  loads the newest results of the known dice thread on open; the dice thread and the GM flag are
  device-local. Pantheon sets up the thread with `!dice` in a thread and moves all rolls of the
  room there. Code in `apps/frontend/src/lib/diceTray/` and
  `lib/components/composer/ComposerDiceTray.svelte`. Frontend only, independent of 0002.

- `0007-tombstone-backfill.patch` – upstream bug fix. When the newest page of a room consists only
  of deleted messages (for example after a cleanup), the room stayed empty after a reload until it
  was opened again: the backfill effect could run while the previous backfill call was still
  settling, return, and never run again. A backfill call that loaded a page now checks again
  itself. One change in `EventList.svelte`; worth reporting upstream.

- `0008-deleted-threads.patch` – upstream bug fix. A deleted thread root whose replies are all
  deleted too stayed visible: in the room as "This message was deleted" with its old reply count
  until a reload (the room timeline never lowers the count when a reply is retracted), and on the
  Threads page as "Message deleted". After a retraction the room store reads the count of its
  loaded deleted roots again; the Threads page omits followed threads with a deleted root and no
  replies. Changes in `@chatto/client` (`MessagesStore`, `timelineSync`) and the Threads page.

### Dice marker (bot ↔ frontend interface)

The only coupling between a dice bot and the renderer is this text format in the message body:

```
[🎲](#chatto-dice:<kind>.<sides>.<value>,<kind>.<sides>.<value>,…;by=<userId>;sw=<outcome>;gm=1)
```

- `;by=<userId>` (optional): Chatto user ID of the person who rolled – the message author is the bot.
  Without `by`, the roll does not play with "Only my rolls".
- `;sw=<outcome>` (optional): result of a Savage Worlds trait roll, shown as a banner: `cf` (critical
  failure), `fail`, `ok` (success), `r1`…`r9` (success with raises). Parameters may come in any order.
- `;gm=1` (optional): the roll was made in the bot's GM mode (the dice tray shows GMs the latest roll
  per player).
- `;sys=<system>` (optional): the bot's dice system of the room, `dh`, `swade` or `raw`; the dice tray
  offers the duality roll only for `dh`. Other `;<name>=<value>` parameters are ignored, so bots can add parameters safely.

A reply to a roll command without dice (an error such as "too many dice", or a hint) carries an
invisible note marker instead: `[\u200b](#chatto-dice-note:by=<userId>)` (the link text is a
zero-width space, so no client shows it; it may carry `;sys=` too). The dice tray (0006) shows such a
note to the roller only. A reply to the bot's system command carries
`[\u200b](#chatto-dice-system:<system>)`, so the tray learns a system change before the next roll.
- `kind`: `hope`, `fear` (Daggerheart duality dice, gold/violet and labelled; together they produce
  the "with Hope / with Fear / Critical success" banner), `adv`/`dis` (d6 advantage/disadvantage),
  `gm` (GM's die), `wild` (Savage Worlds Wild Die, orange and labelled), `std`, `drop` (discarded die,
  grey). Exploding dice are listed once per roll.
- `sides`: 4, 6, 8, 10, 12, 20, 100 (d100 = tens and units d10); other sizes are ignored
- at most 24 dice; an invalid marker stays an ordinary (dead) link

Without the patch clients see a plain 🎲 link; without a bot nothing happens – each side works alone.
