# The README's demos

Records the clip and stills in the project README, `art/*.webp`, by typing real commands into the
build in `dist/`, in a world of its own: a home folder with a project in it, and git repos that
agntc reaches as GitHub repos but that are local bare repos. Nothing reaches the network, the real
home folder or the real git config, so it's safe to record anywhere.

```bash
npm run build
demo/record.sh               # every tape: record it, then make its art
demo/record.sh tour update   # the tapes named
```

## What's recorded

| Tape | Size | Art |
|---|---|---|
| `tour` | 100 × 28 | `art/tour.webp`, `.mp4`: the README's lead: add with its menu, list's dashboard and a detail view, then update with Next and the tally |
| `add` | 100 × 14 | `art/add.webp`, a still: the source's row with the menu asked under it |
| `update` | 100 × 22 | `art/update.webp`, a still: a group moved within its constraint, a local skill refreshed, a pin with newer tags, Next and the tally |
| `list` | 100 × 15 | `art/list.webp`, a still: the dashboard, an install of each state |
| `remove` | 100 × 11 | `art/remove.webp`, a still: a pack's row with its folders, and the confirm |
| `init` | 100 × 16 | `art/init.webp`, a still: the files `init pack` will create, and the confirm |

`look.tape` holds the settings every tape sources.

## The world

`demo/world.sh` builds it under `demo/out/world/`, and each tape builds it afresh, out of sight,
before it shows anything, so a tape records the same thing every time:

- **`acme/team-skills`**: `laravel/`, a pack holding the skills `eloquent` and `testing`, a support
  folder, an agent and a hook, and the loose skills `skills/go` and `skills/python`, at v1.2.0.
- **`acme/writing`**: a skill at the repo's root, at v1.0.0.
- **`~/dev/review`**: a local skill.

`world.sh installed` installs the pack, go, writing pinned to v1.0.0, and the local skill, as list
and update find them. `world.sh upstream` moves the repos on: team-skills tags v1.3.0, with
`migrations` added to the pack and `testing` removed, and v2.0.0, a major outside the `^1.2.0` a
bare add records; writing tags v1.1.0, a newer tag than its pin. Each tag's commit is dated, so
the commit hashes a detail view shows are the same in every recording.

The repos are reached through a `url.insteadOf` in the world's own gitconfig, which the tapes'
shell names in `GIT_CONFIG_GLOBAL`, with `HOME` the world's home, so paths read `~/project`.
`npx` there is a shim that runs a copy of `dist/` staged in `demo/out/agntc/`, whose `package.json`
carries the release the art shows (`stage` in `world.sh` names it), so the header shows it as a
published install would; the repo's own `package.json` keeps its placeholder.
`git` is a shim too, waiting 0.7 seconds before each clone and remote read, as the network would,
so the spinners show.

## The look

Switchboard's: JetBrains Mono, the nord theme, frames twice the 840 px the README shows them at, so
a high-density screen draws them sharp. Switchboard's 160 columns get there at 17px; agntc lays
its output out at most 100 columns wide, so its tapes are 100 columns at 28px. A cell is
16 × 37 px, so the tour is 1680 × 1116 with its 40 px margin. The shell reports `COLORTERM=truecolor`, as Ghostty and
iTerm do, so the accent is agntc's own violet rather than its nearest 256 colours; vhs's terminal
answers agntc's question for its background (OSC 11), so the cursor row carries its band.

## How a tape becomes art

`record.sh` runs each tape through vhs and hands its frames to `finalize.sh`, which makes the art:

- **The frames, not a video.** vhs writes every frame it shows to `demo/out/<name>/`, as the
  terminal drew it. A video's compression shifts every pixel a little from frame to frame, which an
  animated WebP then stores whole; from the frames themselves it stores only what changed,
  losslessly.
- **The art.** For a clip, an animated WebP, which GitHub shows inline, at the frames' 30 a second,
  and an H.264 MP4 of the same frames; for a still, a lossless WebP of the last frame. Each frame
  is set in a margin of the theme's background.

`demo/out/` is remade each time and never committed: `art/` is. Neither is published to npm, as
`package.json`'s `files` holds only `dist`.

## Setting up

```bash
brew install vhs ffmpeg webp
ls ~/Library/Fonts /Library/Fonts | grep JetBrainsMono-Regular
```

vhs records a tape's frames into a directory of its own under `$TMPDIR`, then moves it to the
tape's `Output`. Where `$TMPDIR` is on another volume than the repository, the move fails without a
word, and no frames come: `record.sh` gives vhs a `TMPDIR` in `demo/out` for that.

vhs drives a headless browser that connects to `ttyd` over loopback, which an agent's sandbox
refuses: run `record.sh` with the sandbox off.
