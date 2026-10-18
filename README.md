<div align="center">

# 📦 agntc

**Install Claude skills from git repos, and keep them up to date**

agntc installs skills, agents and hooks into `.claude/` and remembers what it installed,
<br>so updating, listing and removing them takes one command, and packs follow their repo as it changes.

[![npm](https://img.shields.io/npm/v/agntc.svg)](https://www.npmjs.com/package/agntc)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg)](https://www.typescriptlang.org)

[Install](#install) · [Quick start](#quick-start) · [Packs](#packs) · [Commands](#commands) · [Making a pack](#making-a-pack)

<br>

<img src="art/tour.webp" alt="A tour of agntc: add with its menu and what installed as a tree, list's dashboard and a pack's detail view, then update with its version move, Next and the tally" width="840">

</div>

---

## Why agntc?

Skill repos keep changing. Skills get added, renamed and retired, and the agents and hooks around them change too. Copy them in by hand, or install them one by one, and your project is stuck with the repo as it was the day you installed it.

agntc installs a whole **pack** as one thing, and every update brings it back in line with its repo: new skills arrive, retired ones go.

- **Packs that follow their repo.** Additions and removals upstream reach you on the next `update`.
- **Version ranges.** Installs follow semver like any other dependency, and you're told when something newer is out.
- **Nothing lost.** agntc asks before replacing files it didn't install, and an update that can't finish leaves everything as it was.
- **One view of everything.** `list` shows every install, what's out of date, and lets you act on it.
- **Project or global**, and JSON output for [scripts and agents](docs/scripting.md).

## Install

```bash
npx agntc@latest <command>
```

Keep the `@latest`: npx caches, and plain `npx agntc` can run an old version. Or install it globally with `npm install -g agntc`.

## Quick start

```bash
npx agntc@latest add owner/repo    # install from a repo, picking from a menu
npx agntc@latest list              # see what's installed and what has updates
npx agntc@latest update            # bring everything up to date
npx agntc@latest remove owner/repo # remove what came from a repo
```

## Packs

A **skill** is a folder with a `SKILL.md`. A **pack** is a set of skills, plus any agents and hooks that go with them, that installs, updates and removes as one.

Install a pack when you want what its author ships, as they change it. Install loose skills when you want just those skills and nothing more.

## Commands

| Command | What it does |
|---|---|
| [`add`](#add) | Install skills and packs from a git repo or a local folder |
| [`update`](#update) | Bring installs up to date within their version range |
| [`list`](#list) | See what's installed, what has updates, and act on it |
| [`remove`](#remove) | Remove installs and their files |
| [`init`](#init) | Start a new skill or pack |

Add `-g` to work on your global installs in `~/.claude/` instead of the project (every command but `init`).

### `add`

Point it at a repo. One thing found installs straight away; several give you a menu.

<img src="art/add.webp" alt="add acme/team-skills: the source's row, with the menu of its pack and loose skills asked under it" width="840">

```bash
npx agntc@latest add <source> [--skill <names...> | --pack | --all] [--list] [--overwrite] [-g] [--json]
```

| Flag | What it does |
|---|---|
| `--skill <names...>` | Install only the skills you name |
| `--pack` | Install the folder you point at as one pack |
| `--all` | Install everything, without a menu |
| `--list` | Show what's there without installing anything |
| `--overwrite` | Replace files in the way without asking |

The source can be GitHub shorthand (`owner/repo`), a folder inside it (`owner/repo/skills/go`), any HTTPS or SSH git URL, a tree URL, or a local folder. Add a version to choose what to track:

```bash
npx agntc@latest add owner/repo           # the latest release, and updates within ^x.y.z
npx agntc@latest add 'owner/repo@^1.0'    # a version range
npx agntc@latest add owner/repo@v2.0.0    # one exact version
```

### `update`

Brings everything up to date, or just what you name. Packs pick up whatever changed in their repo, and anything removed upstream is asked about before it goes.

<img src="art/update.webp" alt="update: a repo's pack and skill moved from v1.2.0 to v1.3.0 as one row, a local skill refreshed, a pinned skill with newer tags, Next with the adds that reach them, and the tally" width="840">

```bash
npx agntc@latest update [key] [-y] [-g] [--json]
```

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Remove what's gone upstream without asking |

### `list`

Everything installed, grouped by repo, with what has updates. Pick one to update it, change its version or remove it.

<img src="art/list.webp" alt="list's dashboard: installs grouped by repo, each with its kind, version, constraint and status, and the counts of what wants attention" width="840">

```bash
npx agntc@latest list [-g] [--json]
```

### `remove`

Removes an install and every file it put in place. Name one install, a whole repo's, or pick from a list.

<img src="art/remove.webp" alt="remove: a pack's row with its folders under each asset folder, and the confirm under it" width="840">

```bash
npx agntc@latest remove [key] [-y] [-g] [--json]
```

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Remove without asking for confirmation |

### `init`

Starts a new skill or pack in the current folder, ready to fill in.

<img src="art/init.webp" alt="init pack: the folder's row with the files it will create as a tree, and the confirm" width="840">

```bash
npx agntc@latest init [skill|pack] [-y] [--json]
```

| Flag | What it does |
|---|---|
| `-y`, `--yes` | Create the files without asking for confirmation |

## Making a pack

Any folder with a `SKILL.md` is a skill; nothing else is needed. To ship skills, agents and hooks together, mark the folder as a pack with an `agntc.json`:

```
laravel/
  agntc.json          ← {"type": "pack"}
  skills/
    eloquent/SKILL.md
    testing/SKILL.md
  agents/reviewer.md
  hooks/pre-commit.sh
```

`npx agntc@latest init pack` sets this up for you.

## Contributing

`CLAUDE.md` explains how agntc works, and [design/v2.md](design/v2.md) the design behind it. Changes pass `npm test`, `npm run typecheck` and `npm run build`.

## License

MIT
