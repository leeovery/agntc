<div align="center">

# 📦 agntc

**Install Claude skills, agents and hooks from git repos, and keep them current**

agntc installs skills into `.claude/` and records what it installed,
<br>so `update`, `list` and `remove` work on whole installs, and packs follow their repo as it changes.

[![npm](https://img.shields.io/npm/v/agntc.svg)](https://www.npmjs.com/package/agntc)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg)](https://www.typescriptlang.org)

[Install](#install) · [Quick start](#quick-start) · [Packs](#packs) · [Commands](#commands) · [Scripts and agents](#scripts-and-agents) · [Authoring](#authoring)

<br>

<img src="art/tour.webp" alt="A tour of agntc: add with its menu and what installed as a tree, list's dashboard and a pack's detail view, then update with its version move, Next and the tally" width="840">

</div>

---

## Why agntc?

Skill repos change: skills are added, renamed and retired. Install skill by skill and you're left with a snapshot of the repo as it was that day. Vercel's [`skills`](https://github.com/vercel-labs/skills) CLI records each skill on its own, so a skill added upstream never arrives.

agntc installs a **pack** as one thing, and every `update` reads it again: new skills arrive, removed ones go, and its agents and hooks come along.

- **Versioned.** Installs track a semver range, and `update` tells you what's newer.
- **Safe.** Nothing is overwritten without asking, and an update that can't go ahead leaves the install as it was.
- **Project or global**, and JSON output for scripts and agents.

## Install

```bash
npx agntc@latest <command>
```

Keep the `@latest`: npx caches packages, so plain `npx agntc` can run an old version. Or install it globally with `npm install -g agntc`.

## Quick start

```bash
npx agntc@latest add owner/repo                    # install from a repo; a menu if it holds several things
npx agntc@latest add owner/repo/laravel            # one pack or skill, by its path
npx agntc@latest add owner/repo --skill go python  # named skills
npx agntc@latest add 'owner/repo@^1.0'             # within a version range
npx agntc@latest list                              # what's installed, and what has updates
npx agntc@latest update                            # update everything within its range
npx agntc@latest remove owner/repo/laravel         # remove an install
npx agntc@latest init pack                         # scaffold a pack
```

## Packs

A **skill** is a folder with a `SKILL.md`. A **pack** is a folder of skills, with agents and hooks if it has them, that installs, updates and removes as one. Its author declares it with `{"type": "pack"}` in `agntc.json`, or you can with `--pack`.

Install a pack to get what its author ships, as they change it. Install loose skills to get just those skills.

## Commands

| Command | What it does |
|---|---|
| [`add <source>`](#add) | Install skills and packs from a git repo or local folder |
| [`update [key]`](#update) | Update installs within their version range |
| [`list`](#list) | Show what's installed and what has updates, with actions |
| [`remove [key]`](#remove) | Remove installs and their files |
| [`init [skill\|pack]`](#init) | Scaffold a skill or a pack |

Every command but `init` takes `-g` to work on `~/.claude/` instead of the project. Every command takes `--json` (see [Scripts and agents](#scripts-and-agents)).

### `add`

```bash
npx agntc@latest add <source> [--skill <names...> | --pack | --all] [--list] [--overwrite] [-g] [--json]
```

<img src="art/add.webp" alt="add acme/team-skills: the source's row, with the menu of its pack and loose skills asked under it" width="840">

One thing found installs directly; several give a menu.

| Flag | What it does |
|---|---|
| `--skill <names...>` | Install only the named skills, from anywhere in the source |
| `--pack` | Install the source path as one pack |
| `--all` | Install everything found |
| `--list` | Show what the source holds without installing anything |
| `--overwrite` | Replace files in the way without asking |

| Source | Example |
|---|---|
| GitHub shorthand | `owner/repo` |
| A path in the repo | `owner/repo/skills/go` |
| A version range | `'owner/repo@^1.0'`, `'owner/repo@~2.1'` |
| An exact tag | `owner/repo@v2.0.0` |
| HTTPS URL, any host | `https://gitlab.com/org/repo` |
| SSH URL | `git@github.com:owner/repo.git` |
| Tree URL | `https://github.com/owner/repo/tree/main/laravel` |
| Local folder | `./my-skills`, `~/dev/skills` |

A bare `owner/repo` installs the latest semver tag and tracks `^major.minor.patch`; a repo without tags installs its default branch.

### `update`

```bash
npx agntc@latest update [key] [-y] [-g] [--json]
```

<img src="art/update.webp" alt="update: a repo's pack and skill moved from v1.2.0 to v1.3.0 as one row, a local skill refreshed, a pinned skill with newer tags, Next with the adds that reach them, and the tally" width="840">

Updates everything, or the installs a key names (`owner/repo` names all of a repo's). Packs pick up what changed upstream, and anything gone upstream is asked about first.

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Remove what's gone upstream without asking |

### `list`

```bash
npx agntc@latest list [-g] [--json]
```

<img src="art/list.webp" alt="list's dashboard: installs grouped by repo, each with its kind, version, constraint and status, and the counts of what wants attention" width="840">

What's installed and its update status. Pick one to update it, change its version or remove it.

### `remove`

```bash
npx agntc@latest remove [key] [-y] [-g] [--json]
```

<img src="art/remove.webp" alt="remove: a pack's row with its folders under each asset folder, and the confirm under it" width="840">

Removes an install, or every install a key names. Without a key, you pick from a list.

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Remove without asking for confirmation |

### `init`

```bash
npx agntc@latest init [skill|pack] [-y] [--json]
```

<img src="art/init.webp" alt="init pack: the folder's row with the files it will create as a tree, and the confirm" width="840">

Scaffolds a skill or a pack. Files already there are left alone.

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Scaffold without asking for confirmation |

## Scripts and agents

Without a terminal, or with `--json`, every command prints one JSON document and never waits. Where a terminal would ask a question, the command stops instead, naming the flag that answers it:

| Question | Answer with |
|---|---|
| What to install | `--skill`, `--pack` or `--all` |
| Replace files in the way | `--overwrite` |
| Confirm a removal | `remove -y` |
| What to remove | `remove <key>` |
| Remove what's gone upstream | `update -y` (otherwise it's kept) |
| What to scaffold | `init <type> -y` |

## Authoring

A folder with a `SKILL.md` is a skill; nothing else is needed. To ship skills, agents and hooks together, make a pack:

```
laravel/
  agntc.json          ← {"type": "pack"}
  skills/
    eloquent/SKILL.md
    testing/SKILL.md
  agents/reviewer.md
  hooks/pre-commit.sh
```

## Contributing

`CLAUDE.md` describes how agntc works, and [design/v2.md](design/v2.md) the design. Changes pass `npm test`, `npm run typecheck` and `npm run build`.

## License

MIT
