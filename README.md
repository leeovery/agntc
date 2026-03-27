<div align="center">

# agntc

**Agent skills and knowledge installer for AI coding agents**

A CLI that installs AI skills, agents, and hooks from git repos into projects,
<br>with multi-agent support and manifest-based tracking.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg)](https://www.typescriptlang.org)

[Install](#install) · [Quick Start](#quick-start) · [Commands](#commands) · [Plugin Types](#plugin-types) · [Why agntc?](#why-agntc)

</div>

---

agntc is a standalone CLI for installing shareable AI capabilities (skills, agents, hooks) from git repositories into any project. It works with multiple AI coding agents through a driver architecture — same source repo, different target directories per agent.

Everything is tracked in a manifest file, so you can update, remove, and list installed plugins without manual bookkeeping.

## Why agntc?

Skills and agents are scattered across repos with no standard installation method. Current approaches have problems:

- **Manual copy** — tedious, no version tracking, easy to forget what came from where
- **npm postinstall** — tied to Node.js projects, couples plugin lifecycle to package manager
- **git submodules** — heavyweight, nested repo complexity, merge conflicts
- **[Vercel skills](https://github.com/vercel-labs/skills)** — skills only, no agents or hooks, telemetry

agntc sits in between: simple `add` command, manifest tracking, multi-agent routing, and support for all asset types.

### Key differences

| | agntc | Vercel skills | Manual | npm postinstall |
|---|---|---|---|---|
| Skills | Yes | Yes | Yes | Yes |
| Agents | Yes | No | Yes | Yes |
| Hooks | Yes | No | Yes | Yes |
| Multi-asset plugins | Yes | No | No | No |
| Collections | Yes | No | No | No |
| Version tracking | Manifest | Manifest | None | package.json |
| File-level tracking | Yes | No | No | No |
| Update command | Yes | Yes | No | Rebuild |
| Non-Node projects | Yes | Yes | Yes | No |
| Telemetry | No | Yes | No | No |

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
npx agntc@latest init                        # scaffold a new plugin
npx agntc@latest add owner/repo              # install latest, auto-constrain to ^major
npx agntc@latest add owner/repo@^1.0         # install with semver constraint
npx agntc@latest add owner/repo@v2.0.0       # pin to exact tag
npx agntc@latest list                        # see installed + update status
npx agntc@latest update                      # update all (respects constraints)
npx agntc@latest remove owner/repo           # remove plugin
```

## Commands

### `init`

Scaffold a new agntc plugin for authoring. Interactive type and agent selection.

```bash
npx agntc@latest init
```

| Type | Scaffolded Structure |
|---|---|
| Skill | `agntc.json`, `SKILL.md` |
| Plugin | `agntc.json`, `skills/my-skill/SKILL.md`, `agents/`, `hooks/` |
| Collection | `my-plugin/` subdirectory with full plugin structure |

If `agntc.json` already exists, offers to reconfigure (overwrites config) or cancel.

### `add`

Install plugins from git repos or local paths. Interactive agent and plugin selection.

```bash
npx agntc@latest add <source>
```

| Source Format | Example | Notes |
|---|---|---|
| GitHub shorthand | `owner/repo` | Auto-resolves latest semver tag, applies `^` constraint |
| With constraint | `owner/repo@^1.0`, `owner/repo@~2.1` | Resolves best match within range |
| Exact tag | `owner/repo@v2.0.0` | Pin to specific version, no constraint |
| HTTPS URL | `https://github.com/owner/repo` | Any git host |
| SSH URL | `git@github.com:owner/repo.git` | For SSH auth |
| Local path | `./my-plugin`, `~/dev/plugin` | Local development |
| Direct path | `https://github.com/owner/repo/tree/main/plugin-name` | Collection shortcut |

```bash
npx agntc@latest add leeovery/agentic-workflows     # auto-constrain ^latest
npx agntc@latest add leeovery/agentic-workflows@^1.0              # semver constraint
npx agntc@latest add leeovery/agentic-workflows@v1.0.0            # exact tag
npx agntc@latest add ./local-plugin
npx agntc@latest add https://gitlab.com/org/repo
```

The tool detects plugin type automatically, shows agent multiselect (pre-selecting detected agents), checks for conflicts, and copies assets to agent-specific directories.

**Version constraint behaviour:**
- Bare `owner/repo` — if the remote has semver tags, the latest is resolved and a `^major.minor.patch` constraint is auto-applied
- `@^1.0` / `@~2.1` — explicit semver range; the best matching tag is installed
- `@v2.0.0` — exact tag pin, no constraint stored
- If no semver tags exist on the remote, the default branch HEAD is used with no constraint

### `remove`

Remove installed plugins and their files.

```bash
npx agntc@latest remove [key]
```

| Mode | Command | Behaviour |
|---|---|---|
| Interactive | `npx agntc@latest remove` | Pick from installed plugins |
| Standalone | `npx agntc@latest remove owner/repo` | Remove the plugin |
| Collection (all) | `npx agntc@latest remove owner/repo` | Remove all from collection |
| Collection (one) | `npx agntc@latest remove owner/repo/name` | Remove specific plugin |

```bash
npx agntc@latest remove                           # interactive picker
npx agntc@latest remove leeovery/claude-workflows
npx agntc@latest remove leeovery/agent-skills/go
```

Always confirms before deleting files.

### `update`

Check remote state and re-install plugins when newer versions exist.

```bash
npx agntc@latest update [key]
```

| Mode | Command | Behaviour |
|---|---|---|
| Update all | `npx agntc@latest update` | Update all installed |
| Specific plugin | `npx agntc@latest update owner/repo` | Update one (or all from collection) |
| Collection plugin | `npx agntc@latest update owner/repo/name` | Update specific |

```bash
npx agntc@latest update                           # update all
npx agntc@latest update leeovery/claude-workflows
```

Uses nuke-and-reinstall: deletes existing files, re-clones at same ref, re-copies for same agents. Constrained plugins update to the best match within their constraint range. Tag-pinned plugins show available newer tags but don't auto-upgrade.

### `list`

Interactive management dashboard with update status and inline actions.

```bash
npx agntc@latest list
```

Shows all installed plugins with status indicators:

```
  leeovery/claude-technical-workflows@v2.1.6    ✓ Up to date
  leeovery/agent-skills/go                      ↑ Update available
  leeovery/agent-skills/python@v1.0             ⚑ Newer tags available
  leeovery/my-plugin@v1.2.0 (^1.0)             ↑ Constrained update available
  leeovery/other-plugin                         ✗ Check failed

  Done
```

Select a plugin for detail view with actions: Update, Remove, Change version, Back.

The detail view shows constraint info when applicable and flags out-of-constraint versions. "Change version" lets you pick any available tag and strips the constraint (pins to exact tag).

## Plugin Types

agntc detects plugin type from directory structure, not configuration fields.

### Bare Skill

Single skill with `SKILL.md` at root:

```
my-skill/
  agntc.json          ← {"agents": ["claude"]}
  SKILL.md
  references/
    cheatsheet.md
```

### Multi-Asset Plugin

Multiple asset types in recognized directories:

```
my-plugin/
  agntc.json          ← {"agents": ["claude"]}
  skills/
    planning/SKILL.md
    review/SKILL.md
  agents/
    executor.md
  hooks/
    pre-commit.sh
```

### Collection

Multiple installable units in one repo (no root `agntc.json`):

```
my-collection/
  README.md
  go/
    agntc.json        ← {"agents": ["claude", "codex"]}
    SKILL.md
  python/
    agntc.json        ← {"agents": ["claude"]}
    SKILL.md
  complex-tool/
    agntc.json
    skills/
    agents/
```

Installing from a collection presents a multiselect of available plugins.

## Plugin Configuration

Every installable unit requires an `agntc.json` at its root:

```json
{
  "agents": ["claude", "codex"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `agents` | `string[]` | Yes | Agent identifiers this plugin supports |

Valid agents: `claude`, `codex`. Unknown values are warned but ignored.

## Supported Agents

| Agent | Skills | Agents | Hooks |
|---|---|---|---|
| Claude | `.claude/skills/` | `.claude/agents/` | `.claude/hooks/` |
| Codex | `.agents/skills/` | — | — |

Adding new agents is config-only — implement a driver with detection and routing.

## Manifest

Tracks installations at `.agntc/manifest.json`:

```json
{
  "leeovery/claude-technical-workflows": {
    "ref": "v2.1.6",
    "commit": "abc123f",
    "installedAt": "2026-02-09T14:30:00Z",
    "agents": ["claude"],
    "files": [
      ".claude/skills/technical-planning/",
      ".claude/agents/task-executor.md"
    ],
    "constraint": "^2.1.6"
  }
}
```

The `files` array enables clean removal and nuke-and-reinstall updates. The optional `constraint` field stores the semver range for constrained updates.

## License

MIT
