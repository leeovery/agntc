<div align="center">

# agntc

**Agent skills installer for Claude**

A CLI that installs Claude skills, agents and hooks from git repos into projects,
<br>with version constraints and manifest-based tracking.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg)](https://www.typescriptlang.org)

[Install](#install) · [Quick Start](#quick-start) · [Commands](#commands) · [Skills and Packs](#skills-and-packs) · [Without a Terminal](#without-a-terminal)

</div>

---

agntc installs skills from git repositories, yours or anyone else's, into a project's `.claude/` folder, or into `~/.claude/` with `-g`. Point it at a repo and it finds every skill inside, however the repo is laid out. Everything it installs is tracked in a manifest, so you can update, remove and list installs without manual bookkeeping.

agntc targets Claude only.

## Why agntc?

- **Any repo layout.** Skills are found by walking the repo, not by a fixed folder convention.
- **Packs.** A set of skills plus agents and hooks installs, updates and removes as one entry.
- **Versions.** Semver tags are resolved and constrained, so `update` stays within the range you chose.
- **File-level tracking.** Every installed path is recorded, so updates and removals are clean.
- **Safe copies.** Path traversal and symlinks are checked before anything is written, and agntc never writes or deletes through a symlink it finds in the destination.
- **Scriptable.** Without a terminal it never waits on a prompt and prints JSON.

## Install

**Run directly with npx (recommended)**

```bash
npx agntc@latest <command>
```

> `npx` caches packages locally, so plain `npx agntc` may run a stale version. Using `@latest` ensures you always get the newest release.

**Or install globally**

```bash
npm install -g agntc
```

## Quick Start

```bash
npx agntc@latest add owner/repo                    # find what's in the repo; menu if more than one thing
npx agntc@latest add owner/repo --skill go python  # install named skills
npx agntc@latest add owner/repo/laravel            # install from a path in the repo
npx agntc@latest add 'owner/repo@^1.0'             # install with a semver constraint
npx agntc@latest add -g owner/repo                 # install into ~/.claude/
npx agntc@latest list                              # see installs + update status
npx agntc@latest update                            # update all (respects constraints)
npx agntc@latest remove owner/repo/go              # remove one install
npx agntc@latest init skill                        # scaffold a new skill
```

## Skills and Packs

A **skill** is a folder with a `SKILL.md`. Everything inside the folder belongs to it, including any `agents/` folder of its own. A skill installs to `.claude/skills/<folder-name>/`.

A **pack** is a set of skills, optionally with agents and hooks, that installs, updates and removes as one entry. A pack is always declared, never inferred from folder shape:

- the author declares it with `{"type": "pack"}` in the folder's `agntc.json`, or
- the user declares it with `--pack` when adding.

A pack holds every skill found inside it, plus the `.md` files in its own top-level `agents/` and everything in its own top-level `hooks/`. Its skills install flat, like any other skill.

A pack also installs everything in its own top-level `skills/` folder. A folder there that holds no skill is a **support folder**, such as shared references its skills load, and installs whole beside them, whatever is in it. A folder there that holds skills deeper down is a category, and its own folders are read the same way. Loose files, links, hidden folders, `node_modules`, `dist`, `build` and `vendor` in `skills/` aren't installed.

| Asset | Installs to |
|---|---|
| skills, and a pack's support folders | `.claude/skills/<folder-name>/` |
| agents (`.md` files) | `.claude/agents/` |
| hooks | `.claude/hooks/` |

Agents and hooks install only as part of a pack. A folder with `agents/` or `hooks/` that isn't a pack gets a notice naming the `--pack` line that would install them.

## Commands

### `add`

Install skills and packs from a git repo or local path.

```bash
npx agntc@latest add <source> [options]
```

| Source Format | Example | Notes |
|---|---|---|
| GitHub shorthand | `owner/repo` | Auto-resolves latest semver tag, applies `^` constraint |
| With a path | `owner/repo/skills/go` | Search starts at that folder |
| With constraint | `owner/repo@^1.0`, `owner/repo@~2.1` | Resolves best match within range |
| Exact tag | `owner/repo@v2.0.0` | Pin to a specific version, no constraint |
| HTTPS URL | `https://gitlab.com/org/repo`, `https://gitlab.com/org/repo/skills/go` | Any git host; a path after the repo works as in shorthand |
| SSH URL | `git@github.com:owner/repo.git`, `git@gitlab.com:org/repo/skills/go` | For SSH auth; takes a path the same way |
| Tree URL | `https://github.com/owner/repo/tree/main/laravel` | Branch plus path |
| Local path | `./my-skills`, `~/dev/skills` | Local development |

**How a source is searched.** agntc walks down from the path you added, the repo root unless you gave a path after the repo:

- a folder with `SKILL.md` is a skill and isn't entered;
- a folder declaring a pack is recorded and isn't entered;
- any other folder is descended into, up to 5 levels, so category folders like `skills/frontend/` need no configuration.

Hidden folders, `node_modules`, `dist`, `build` and `vendor` are skipped. Packs don't nest. A skill's identity is its folder name.

**Choosing what to install.**

- One thing found installs without a menu.
- Several give a menu: one line per pack, loose skills shown by path. The menu never splits a pack.
- `--skill <names...>` installs the named skills, matching folder name or frontmatter `name`, anywhere in the source, including inside a pack. A skill taken out of a pack installs on its own, with a note naming the pack and what's left out, its support folders included. A name found twice is refused, listing the paths.
- `--pack` installs the added path as one pack. It's refused on a single skill and on a path that contains packs.
- `--all` installs everything the menu would list.
- `--list` shows what the source holds and installs nothing: packs with their skill and support folder counts, skills with their path and description. It combines with `--pack` only.

`--pack`, `--skill` and `--all` don't combine. `--plugin` still works as an alias for `--pack`, with a note that it's been renamed.

```bash
npx agntc@latest add leeovery/agentic-workflows                 # auto-constrain ^latest
npx agntc@latest add leeovery/agentic-skills --list             # see what's there
npx agntc@latest add leeovery/agentic-skills --skill go         # one skill
npx agntc@latest add leeovery/agentic-skills/laravel            # a declared pack, by path
npx agntc@latest add owner/skills-repo/tools --pack             # bundle a folder as one pack
npx agntc@latest add ./local-skills --all
```

**Files in the way.** If an install would land on files another install owns, or files agntc didn't install, agntc asks before replacing them. `--overwrite` replaces them without asking. Without a terminal and without `--overwrite`, that item stops and the rest install.

A skill already installed as part of a pack from the same repo isn't installed again on its own; agntc says so. Installing a pack takes over loose skills from its own repo without asking.

**Version constraint behaviour:**
- Bare `owner/repo`: if the remote has semver tags, the latest is resolved and a `^major.minor.patch` constraint is auto-applied. On 0.x the caret locks the minor.
- `@^1.0` / `@~2.1`: explicit semver range; the best matching tag is installed. Quote the source in a shell (`'owner/repo@^1.0'`): zsh's extended globbing reads `^` and `~` as patterns. Commands agntc prints are quoted already.
- `@v2.0.0`: exact tag pin, no constraint stored.
- If no semver tags exist on the remote, the default branch HEAD is used with no constraint.

### `remove`

Remove installs and their files.

```bash
npx agntc@latest remove [key] [-y]
```

| Mode | Command | Behaviour |
|---|---|---|
| Interactive | `npx agntc@latest remove` | Pick from installs |
| One install | `npx agntc@latest remove owner/repo/go` | Remove that skill or pack |
| Whole repo | `npx agntc@latest remove owner/repo` | Remove everything installed from the repo |

Asks for confirmation before deleting files; `-y` skips it.

### `update`

Check remote state and reinstall when newer versions exist.

```bash
npx agntc@latest update [key] [-y]
```

Uses nuke-and-reinstall: deletes the install's files, re-clones at the resolved ref and copies again. Constrained installs update to the best match within their range. Tag-pinned installs show newer tags but don't auto-upgrade. Every check runs before any file is deleted; if the new tree can't be installed, it would remove a folder the repo still has, or other files are in the way of it, the update aborts with the existing install left intact and prints the remedy.

- **Packs are re-walked.** Skills and support folders added upstream arrive; those removed upstream go.
- **Moved skills are followed.** A loose skill whose folder moved is found again when exactly one skill in the repo has its name. New skills are never picked up for loose skills; install the folder as a pack for that.
- **Keys follow what's installed.** When an install comes back as something `add` would key differently, such as a pack whose folder is now a single skill or a skill that moved out of the repo root, it moves to that key and a note names both. If another install already has that key, the update stops and says how to free it, unless that install is a loose skill the pack takes over.
- **Nothing the repo still has is dropped.** If an update would remove a folder from `.claude/skills/` that the repo still holds outside anything the new install includes, it stops, names the folders and prints the `remove` and `add` that update it anyway. A folder that now installs nested inside a skill, and a category folder an older agntc installed whole whose skills now install on their own, go without stopping.
- **Gone upstream.** A skill or declared pack that no longer exists upstream prompts `remove it?`. Yes deletes it; no keeps it at its last version and asks again next time. `-y` removes without asking. Without a terminal and without `-y`, it's kept and reported. Gone upstream is never an error.
- **Packs absorb loose skills.** When a pack now holds a skill you installed on its own from the same repo, the pack takes it over and the loose entry goes.

**Update-all is grouped and streamed.** Installs from the same repo at the same version intent are checked once and cloned once per group. A key naming several installs, such as `update owner/repo` over its loose skills, updates those installs the same way. Progress streams under a header per group, then a trailing summary:

```
◒ Checking for updates...
◒ Updating leeovery/agentic-skills  v1.2.3 -> v1.3.0  (3 members)
   ✓ go
   ✓ python
   ✓ laravel
✓ leeovery/standalone-tool: Updated v1.4.0 -> v1.5.0

leeovery/agentic-skills: 4 up to date
Newer versions outside constraints:
  leeovery/agentic-workflows  v1.4.0 -> v2.0.0 available. To upgrade: npx agntc add leeovery/agentic-workflows --pack
```

- **Version moves render in tags** when both refs are semver tags and the ref moved; branch and HEAD-tracked updates show short commit hashes.
- **The trailing summary collapses to one line per group** for up-to-date, newer-tags, check-failed and no-matching-version installs.
- **Newer versions print the command to reach them.** A major bump (or a 0.x minor bump) outside your constraint prints a bare re-add, which re-establishes the caret at the new major; a tag-pinned install with newer tags prints a re-add at `@<newest>`. The command matches what you installed: its path, `--pack` for a pack, and several loose skills from one repo on one `--skill` line. These are informative and exit 0.
- An aborted, blocked or failed install exits non-zero, and the rest still update.
- A dead remote or a stuck constraint warns and exits 0 when updating all, and exits non-zero when updating by key, whether the key names one install or several.

### `list`

Interactive dashboard with update status and inline actions.

```bash
npx agntc@latest list
```

Each install is listed with its key and version; the highlighted one shows its status: `✓ up to date`, `↑ update available`, `⚑ newer tags`, `● local`, `✗ check failed` or `✗ no matching version`.

Select an install for a detail view with actions: Update, Remove, Change version, Back. The detail view shows the constraint and any version outside it. "Change version" lets you pick any tag and strips the constraint (pins to that tag).

### `init`

Scaffold a skill or a pack in the current directory.

```bash
npx agntc@latest init [skill|pack] [-y]
```

| Type | Scaffolded |
|---|---|
| `skill` | `SKILL.md` with `name` and `description` frontmatter |
| `pack` | `agntc.json` (`{"type": "pack"}`), `skills/my-skill/SKILL.md`, `agents/my-agent.md`, `hooks/my-hook.sh` |

At a terminal, `init` asks for the type when it isn't given and confirms before writing; `-y` skips the confirmation. Without a terminal, it needs both the type and `-y`, and refuses naming them otherwise.

## Global Installs

`-g` (`--global`) on `add`, `remove`, `update` and `list` installs into `~/.claude/` (skills, agents and hooks) with the manifest at `~/.agntc/manifest.json`.

```bash
npx agntc@latest add -g leeovery/agentic-skills --skill go
npx agntc@latest update -g
npx agntc@latest list -g
```

Each command works within one scope: `update` without `-g` never touches global installs, and `update -g` never touches the project. Re-add and remove commands agntc prints carry `-g` for global installs.

A skill in `~/.claude/skills` that agntc didn't install, such as one another tool set up, counts as files in the way: `--overwrite` replaces it, and without a terminal or `--overwrite` that item stops. A symlink found there is unlinked as a link, never followed.

## Without a Terminal

agntc is safe to run from an AI agent, a script or CI. When stdin or stdout isn't a terminal, it never waits on a prompt:

- **Output is JSON.** One document per command on stdout, with `ok`, `command`, `scope` (`"project"` or `"global"`, on the commands that take `-g`), the command's result, `warnings` and `notes`. Errors are JSON too, with a non-zero exit. `--json` forces this at a terminal.
- **Every question is answered by a flag, or the command stops.** It exits non-zero and the error names the flags that would answer it:

| Question | Flag | Without it |
|---|---|---|
| What to install | `--skill`, `--pack`, `--all`, or a path to one skill or pack | `add` refuses, listing what it found |
| Replace files in the way | `--overwrite` | That item stops, the rest install |
| Confirm `remove` | `-y` | `remove` refuses |
| Remove what's gone upstream | `update -y` | Kept and reported |
| What to remove | `remove <key>` | `remove` refuses |

```bash
npx agntc add owner/repo --list --json
npx agntc add owner/repo --skill go python --overwrite
npx agntc remove owner/repo/go -y
```

## Authoring

`agntc.json` is optional. A repo of skill folders needs no configuration: `SKILL.md` makes a skill, and identity is the folder name. Descriptions in `SKILL.md` frontmatter are shown in the menu and `--list`.

Declare a pack when its skills, agents and hooks belong together:

```
laravel/
  agntc.json          ← {"type": "pack"}
  skills/
    eloquent/SKILL.md
    testing/SKILL.md
    shared/           ← no SKILL.md: installs whole to .claude/skills/shared/
  agents/
    reviewer.md       ← installs to .claude/agents/reviewer.md
  hooks/
    pre-commit.sh     ← installs to .claude/hooks/pre-commit.sh
```

- `agntc.json` carries only `type`. `"pack"` declares a pack; the old `"plugin"` is read as `"pack"`. Malformed or missing config is ignored.
- A folder with both `SKILL.md` and a pack declaration is treated as a skill, with a warning.
- Only `.md` files under a pack's `agents/` install as agents, hidden ones aside. Every entry in its `hooks/` installs.
- A folder in a pack's `skills/` with no skill in it installs whole as a support folder, so the pack's skills can share references through it.
- A user can still take one skill out of your pack with `--skill`; it installs on its own, without the pack's support folders.
- `agntc.json` is never copied into an install.

## Manifest

Tracks installs at `.agntc/manifest.json` (or `~/.agntc/manifest.json` with `-g`):

```json
{
  "leeovery/agentic-skills/laravel": {
    "ref": "v1.3.0",
    "commit": "abc123f",
    "installedAt": "2026-10-13T14:30:00Z",
    "files": [
      ".claude/skills/eloquent/",
      ".claude/agents/reviewer.md"
    ],
    "type": "pack",
    "cloneUrl": "https://github.com/leeovery/agentic-skills.git",
    "constraint": "^1.3.0"
  }
}
```

A pack is keyed by its path in the repo; a loose skill by its folder name, with `sourceSubpath` recording where it lives when the key doesn't spell it. The `files` array drives removal and nuke-and-reinstall. `type` is `"skill"` or `"pack"`, and `update` replays it rather than re-detecting.

## Upgrading from 0.x

v2 is a breaking release.

- **Claude only.** Codex and Cursor support is gone, along with the agent prompt and `agents` in `agntc.json`. Installs made for several agents move to `.claude/` on their next `update`; the `.agents/skills` and `.cursor/skills` copies are removed.
- **Plugins are packs.** Manifest entries of type `plugin` are read as packs, and config `"type": "plugin"` still declares a pack. An old plugin entry whose folder is a single skill reinstalls as a skill. An old entry keyed differently from how `add` keys it now, such as a plugin recorded by name with its path beside it, moves to that key on its next update.
- **Packs must be declared.** Folder shape no longer makes a plugin: a folder with `agents/` or `hooks/` but no `{"type": "pack"}` is searched for skills, and its agents and hooks aren't installed. Use `--pack`, or ask the author to declare it.
- **Collections are gone.** A repo with several things in it gives a menu.
- `--plugin` is now `--pack`; the old flag still works.

## License

MIT
