<div align="center">

# 📦 agntc

**Install Claude skills, agents and hooks from git repos, and keep them current**

agntc installs skills into `.claude/` and records what it installed,
<br>so `update`, `list` and `remove` work on whole installs, and packs follow their repo as it changes.

[![npm](https://img.shields.io/npm/v/agntc.svg)](https://www.npmjs.com/package/agntc)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg)](https://www.typescriptlang.org)

[Install](#install) · [Quick start](#quick-start) · [Packs](#packs) · [Commands](#commands) · [Authoring](#authoring)

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

Or `npm install -g agntc`.

## Quick start

```bash
npx agntc@latest add owner/repo            # install from a repo, with a menu if it holds several things
npx agntc@latest add owner/repo/laravel    # install one pack or skill by its path
npx agntc@latest list                      # see what's installed and what has updates
npx agntc@latest update                    # update everything
npx agntc@latest remove owner/repo/laravel # remove an install
```

## Packs

A **skill** is a folder with a `SKILL.md`. A **pack** is a folder of skills, with agents and hooks if it has them, that installs, updates and removes as one. Its author declares it with `{"type": "pack"}` in `agntc.json`, or you can with `--pack`.

Install a pack to get what its author ships, as they change it. Install loose skills to get just those skills.

## Commands

`-g` works on `~/.claude/` instead of the project, and `--json` prints JSON for scripts.

### `add`

```bash
npx agntc@latest add <source>
```

<img src="art/add.webp" alt="add acme/team-skills: the source's row, with the menu of its pack and loose skills asked under it" width="840">

A source is a GitHub `owner/repo`, any git URL, or a local folder, optionally with a path or a version (`@^1.0`, `@v2.0.0`). Pick skills by name with `--skill`, or everything with `--all`.

### `update`

```bash
npx agntc@latest update [key]
```

<img src="art/update.webp" alt="update: a repo's pack and skill moved from v1.2.0 to v1.3.0 as one row, a local skill refreshed, a pinned skill with newer tags, Next with the adds that reach them, and the tally" width="840">

Brings installs up to date within their version range. Packs pick up what changed upstream, and anything gone upstream is asked about first.

### `list`

```bash
npx agntc@latest list
```

<img src="art/list.webp" alt="list's dashboard: installs grouped by repo, each with its kind, version, constraint and status, and the counts of what wants attention" width="840">

What's installed and its update status. Pick one to update it, change its version or remove it.

### `remove`

```bash
npx agntc@latest remove [key]
```

<img src="art/remove.webp" alt="remove: a pack's row with its folders under each asset folder, and the confirm under it" width="840">

Removes an install and its files, or every install from a repo.

### `init`

```bash
npx agntc@latest init [skill|pack]
```

<img src="art/init.webp" alt="init pack: the folder's row with the files it will create as a tree, and the confirm" width="840">

Scaffolds a skill or a pack.

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
