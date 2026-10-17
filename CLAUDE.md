# CLAUDE.md

## Project Overview

agntc is a CLI that installs Claude skills, agents and hooks from git repos and local folders, and records what it installed so it can update, list and remove it. Claude only: assets install under `.claude/` in the project, or `~/.claude/` with `-g`. The settled v2 design is `design/v2.md`; the code and its tests are the detail.

## Commands

- `add <source>` — walk the source, install one thing directly or offer a menu of several. `--skill <names...>`, `--pack` (`--plugin` hidden alias), `--all`, `--list`, `--overwrite`.
- `update [key]` — nuke-and-reinstall within each version constraint; `-y` removes what's gone upstream.
- `list` — dashboard with update status and actions (update, change version, remove).
- `remove [key]` — a key, or every key under a prefix; a picker without one; `-y` skips the confirmation.
- `init [skill|pack]` — scaffold a skill or a pack; `-y` skips the confirmation.
- `-g`/`--global` on `add`, `update`, `list`, `remove`: install root `~`, manifest `~/.agntc/manifest.json`. A command stays within one scope. `--json` on every command.

## Code map

- `src/cli.ts` — commander entry; `src/commands/` — one file per command (list's actions and detail view beside it); `src/init/` — scaffolding.
- `src/command-action.ts` — resolves the mode, builds the matching `Ui`, writes the machine document, maps `ExitSignal` to the exit code.
- `src/ui.ts` — the `Ui` interface, `MachineUi`, prompt shapes and tallies. `src/terminal/` — `TerminalUi` and its renderer (layout, rows, tasks, Next, close, signals, the prompts on `@clack/core`).
- `src/*-render.ts` — the rows each command draws; `src/documents.ts` — each command's JSON body.
- The rest of `src/` is the domain: discovery (`discover.ts`, `choose-items.ts`), keys and items (`install-item.ts`), copying and its safety (`copy-*.ts`, `install-paths.ts`, `nuke-files.ts`), conflicts (`clear-conflicts.ts`, `collision-*`, `unmanaged-*`), update (`clone-reinstall.ts`, `nuke-reinstall-pipeline.ts`, `update-groups.ts`, `update-check*.ts`, `version-resolve.ts`), the manifest (`manifest.ts`), git (`git-*.ts`).
- `tests/` holds a test file per module; `tests/terminal/` the renderer's tests and the `*-golden` tests of whole runs.

## Concepts

- **Skill** — a folder with `SKILL.md`. Everything inside belongs to it. Installs to `.claude/skills/<folder>/`.
- **Pack** — skills plus the pack's own top-level `agents/` (`.md` files) and `hooks/` (every entry), installed, updated and removed as one entry. Always **declared**, never inferred from shape: `{"type": "pack"}` in `agntc.json` (legacy `"plugin"` reads as pack), or `--pack` on the added path. `agntc.json` is optional and carries only `type`.
- **Support folder** — a folder in a pack's own `skills/` that holds no skill. Installs whole as `.claude/skills/<name>/` and claims its target as a skill does, but is never a skill: no `--skill` match, no entry, no moved-skill candidate, never absorbed. A folder there that holds skills deeper down is a category, read the same way.
- **Stray** — a non-pack folder with `agents/` or `hooks/`. Gets a notice with the `--pack` line; agents and hooks install only as part of a pack.
- **Key** — a manifest entry's name. Root item → the source key (`owner/repo`, or the local root); loose skill → `<source>/<folder>` with `sourceSubpath` when the path differs; pack → `<source>/<path>`. `keyItem` is the one rule `add` and `update` share.
- **Manifest entry** — `.agntc/manifest.json`, keyed by key: ref, commit (null for local), files (folders end in `/`), `type`, cloneUrl, `constraint?`, `sourceSubpath?`, `localRoot?`. `files` drives removal and reinstall.
- **Same source** — decides absorption and `add`'s key check. A remote source matches on the repo its clone URL names (`host/owner/repo`), so HTTPS and SSH of one repo match; two recorded local roots match only when equal, so a checkout nested in another is its own source; a legacy derived root matches when either root holds the other.
- **Scope** — project (cwd) or global (`~`).

## Rules that are easy to get wrong

- **Identity is the folder basename**, everywhere. Frontmatter is display and `--skill` matching only.
- **Packs don't nest.** An inner pack declaration is a plain folder.
- **A pack is never inferred** from `agents/`/`hooks/` or any other shape.
- **A link is never followed in the destination.** A link in the way is unlinked as a link; nothing is written or deleted through one, and recorded paths outside the install root are refused.
- **Machine mode never prompts.** A question is a flag or a stop.
- **A key naming several entries runs group-first**, like a bare `update`; only a key naming one entry takes the single-entry path.
- **Nothing is removed before every check has passed** (derive-before-delete, below).

## How it works

**Walk.** From the added path (repo root, `owner/repo/path`, tree URL path or local path): `SKILL.md` → skill, not entered; a pack declaration → pack, not entered; anything else descended, to depth 5. Hidden folders, `node_modules`, `dist`, `build`, `vendor` and linked folders are skipped. `SKILL.md` plus a pack declaration is a skill, with a warning.

**Choosing.** One item installs without a menu; several give a menu (packs, then loose skills, by path; a pack is never split). `--skill` matches anywhere, packs included, and a skill taken from a pack installs loose, without its support folders, with a note. Duplicate names and two items claiming one install path are refused. `--skill`/`--pack`/`--all` are exclusive; `--list` combines only with `--pack`. Skills an installed pack from the same source already holds are left out.

**Asset routing.** Skills and support folders → `.claude/skills/<folder>/` (flat); a pack's agents → `.claude/agents/`; its hooks → `.claude/hooks/`. Paths are relative to the install root.

**Copy safety.** Path-traversal and symlink-escape checks run before any copy, on `add` and `update`. A copy never follows a link: each link in a source is judged by where it points (inside the item, elsewhere in the source, outside it), and one leading out of the clone or local root refuses the item. `copy-safety.ts` holds the rules.

**Files in the way.** Files another entry owns, or that agntc didn't install, are cleared under a policy: `--overwrite` replaces, a terminal asks, machine mode stops that item and the rest install.

**Versions.** A bare `owner/repo` resolves the latest semver tag and records `^major.minor.patch` (0.x caret locks the minor, intended). `@^1.0`/`@~2.1` records the range; `@v2.0.0` pins a tag, no constraint; no tags → default branch HEAD. List's "change version" pins a tag and drops the constraint.

**Update** is nuke-and-reinstall: delete the entry's `files`, re-clone, re-copy.
- **Replays the recorded `type`.** A pack re-walks its path, so additions arrive and removals go; a pack path now a single skill reinstalls as a skill. A loose skill re-copies from its path; if it moved, a whole-source walk follows it when exactly one skill has its name, and aborts with each candidate's re-add when several do. Loose skills never pick up additions; that's what packs are for.
- **Keyed as `add` keys it.** When the replayed item's key differs from the entry's, the entry moves to the new key in the same manifest write, with a note. A new key another entry holds aborts, unless that entry is a loose skill the pack takes over.
- **Derive-before-delete.** Replay, key, files in the way, dropped folders and the escape scan all run before anything is removed. Any of them failing aborts that entry with the install intact and a `remove` + re-add remedy that keeps the entry's version intent.
- **Nothing still upstream is dropped** (`dropped-folders.ts`). A recorded `.claude/skills/<name>/` the reinstall won't write, whose name is still a folder in the item's source outside everything it installs, aborts the entry. It asks the source, never the install rules, so a gap in those rules stops an update rather than deleting what they miss.
- **Gone upstream** is never a failure: `-y` removes, a terminal asks (default no, asked again next run), machine mode keeps and reports.
- **Absorption.** A pack's skills landing on loose entries from its own source take them over (entries dropped). Only its skills by name; a support folder landing on one is files in the way. Units holding a pack update before units without one.
- **Grouping.** A bare `update`, or a key naming several entries, groups non-local entries by `(clone URL, constraint ?? ref)`: one probe, one clone and at most one source walk per group; each member categorizes against the group's target by its own commit. Local entries reinstall one by one. One entry failing doesn't stop the others; any abort or failure exits non-zero. A failed check or no tag in range only warns without a key, and fails with one.
- **Legacy entries** (`type: "plugin"`, missing `type`, `.agents/skills`/`.cursor/skills` paths) are normalized on read and persisted on the next write.

## Machine mode

`--json`, or stdin or stdout not a TTY → `MachineUi`. Never draws, never waits.
- One JSON document per command on stdout: `{ ok, command, scope?, error?, ...body, warnings, notes }`. `ok` is true exactly when the exit code is 0. Errors are documents too. `scope` appears on the commands that take `-g`.
- A prompt reached in machine mode fails the command. Callers check `ui.mode` first and fail with `{ flags }` naming the answer: menu → `--skill`/`--pack`/`--all`; files in the way → `--overwrite` (that item stops, the rest install); `remove` → `-y` or `<key>`; `init` → the type and `-y`; gone upstream → kept and reported, exit 0.
- `update` items report a moved entry's new `key` with its `previousKey`.

## Terminal UI

Every word and question goes through one `Ui` (`src/ui.ts`); commands never write to stdout themselves.
- `TerminalUi` (`src/terminal/terminal-ui.ts`) draws a header, then blocks of rows (a status glyph, subject, meta, detail, children as a tree), tasks that spin until they settle into a row, questions asked under the row or rows they're about and erased with themselves, a Next section of remedies, and a closing tally. It owns SIGINT, SIGTERM and SIGTSTP for the run.
- `MachineUi` draws nothing and collects warnings, notes, the failure and the `report` body into one document.
- `warn`/`note`/`fail` take a `Message`: a string, or rich text with a dim cause, a remedy and the `plain` sentence machine mode prints.
- Terminal output is pinned by the golden tests in `tests/terminal/`; a wording change updates them.

## Conventions

- `CHANGELOG.md` belongs to mint: `mint release` writes each entry from the changes since the last tag. Never edit it, and never add an `[Unreleased]` section.
- Non-null `!` assertions are repo idiom under `noUncheckedIndexedAccess`; don't rewrite them away.
- Every printed `npx agntc …` line is built through `agntcCommand` (`scope.ts`), which adds `-g` and shell-quotes.
- Biome formats and lints (tabs, double quotes).

## Gates

Run `scripts/gate` before reporting work done: it runs every gate (`npm ci` when `node_modules` isn't as it installs, then typecheck, build to `dist/cli.js`, and test) and records a clean tree that passes, so a release finds the record and doesn't run them again (`scripts/gated`, mint's `pre_tag`).
