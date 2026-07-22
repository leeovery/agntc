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

agntc is a standalone CLI for installing shareable AI capabilities (skills, agents, hooks) from git repositories into any project. It works with multiple AI coding agents (Claude, Codex, Cursor) through a driver architecture — same source repo, different target directories per agent.

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

The tool detects plugin type from the repo's directory structure (no `agntc.json` required), checks for conflicts, and copies assets to agent-specific directories. Agent selection:

- A unit that **declares** `agents` shows a multiselect filtered to those agents (detected ones pre-selected). When it declares a single agent that's detected locally, selection is auto-skipped.
- A unit with **no usable `agents`** declaration (configless, empty, or malformed) offers all supported agents (`claude`, `codex`, `cursor`), with detected ones pre-ticked.

**`--plugin` flag** — forces a `skills/`-only source to install as a single bundled plugin instead of the default collection menu. It's a hard error against any non-bundleable structure (a bare skill, or a member-dirs collection).

```bash
npx agntc@latest add owner/bare-skill-repo               # configless, no agntc.json needed
npx agntc@latest add owner/skills-repo --plugin          # bundle a skills-only repo as one plugin
```

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

Uses nuke-and-reinstall: deletes existing files, re-clones at the resolved ref, re-copies for the same agents. Constrained plugins update to the best match within their constraint range. Tag-pinned plugins show available newer tags but don't auto-upgrade.

**Update-all is grouped and streamed.** Manifest entries whose version intent points at the same tree — the members of a collection, or several plugins pinned the same way — are grouped by `(clone URL, version intent)`, checked once, and cloned once per group (a 10-member collection clones once, not ten times). Progress streams under a group header per repo with a per-member outcome line beneath, then a trailing summary:

```
◒ Checking for updates…
◒ Updating leeovery/agent-skills  v1.2.3 -> v1.3.0  (3 members)
   ✓ go     → claude
   ✓ python → claude
   ✓ rust   → claude, codex  (codex support removed by plugin author)
✓ leeovery/standalone-tool: Updated v1.4.0 -> v1.5.0

leeovery/agent-skills: 4 up to date
Newer versions outside constraints:
  leeovery/pinned-plugin  v2.1.0 -> v3.0.0 available. To upgrade: npx agntc add leeovery/pinned-plugin
```

- **Version moves render in tags** when both the old and new refs are genuine semver tags and the ref moved (`v1.2.3 -> v1.3.0`); branch / HEAD-tracked / untagged updates fall back to short commit hashes.
- **The trailing summary collapses to one line per group** — up-to-date counts, newer-tags notices, check failures, and out-of-constraint footers each print once per group rather than once per member. A group can split: behind members update under the header while already-current siblings collapse into the up-to-date count.
- **Out-of-constraint versions are actionable.** A gated major (or 0.x-minor) bump prints the current→newest move plus the exact re-add command, matched to how you pinned: a caret/constrained user gets bare `npx agntc add owner/repo` (re-establishes caret tracking at the new major); an exact-pin user gets `npx agntc add owner/repo@<newest>`. These are informative, not errors — exit stays 0. A batch that hits a dead remote or a stuck constraint warns and still exits 0; only an aborted, blocked, or failed install trips a non-zero exit.

Single-key `update <key>` and the `list` update / change-version actions are unchanged — one clone per invocation.

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

agntc detects plugin type from directory structure, not from configuration fields
or the presence of `agntc.json` (which is optional — shown below as `← optional`).

### Bare Skill

`SKILL.md` at root:

```
my-skill/
  SKILL.md
  references/
    cheatsheet.md
  agntc.json          ← optional {"agents": ["claude"]}
```

### Multi-Asset Plugin

A `skills/` dir plus one or more of `agents/` / `hooks/`:

```
my-plugin/
  skills/
    planning/SKILL.md
    review/SKILL.md
  agents/
    executor.md
  hooks/
    pre-commit.sh
  agntc.json          ← optional {"agents": ["claude"]}
```

### Collection

Multiple installable member units in one repo. Membership is structural — each child
dir that itself resolves to a unit (has `SKILL.md`, or its own asset dirs) is a member:

```
my-collection/
  README.md
  go/                 ← bare-skill member
    SKILL.md
    agntc.json        ← optional {"agents": ["claude", "codex", "cursor"]}
  python/             ← bare-skill member
    SKILL.md
  complex-tool/       ← plugin member
    skills/
    agents/
```

A repo whose root holds only `skills/` is treated as a collection menu of those inner
skills by default (Vercel-compatible); pass `--plugin` (or set `type: "plugin"`) to
bundle it as a single plugin instead.

Installing from a collection presents a multiselect of available members. Config-bearing
and configless members can coexist in the same collection.

## Plugin Configuration

`agntc.json` is **optional**. Type, identity, and installability are derived from
directory structure alone — so any skill, plugin, or collection installs straight
from a bare git repo with no config at all. When present, `agntc.json` lives inside
an installable unit (a bare skill, a plugin, or each collection member — never the
collection container) and carries only author intent that structure can't express:

```json
{
  "agents": ["claude", "codex", "cursor"],
  "type": "plugin"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `agents` | `string[]` | No | Restricts which agents this unit targets (a hard ceiling). Absent/empty/malformed → all agents offered. |
| `type` | `"plugin"` | No | Bundle disambiguator for the one ambiguous shape (a `skills/`-only repo). Any other value is ignored. |

Valid agents: `claude`, `codex`, `cursor`. Unknown values are warned but ignored.
Config *presence* never signals type, and config reading is lenient — a missing,
malformed, or empty `agntc.json` is treated as "no usable config", never an error.
A well-formed `type` that contradicts an unambiguous structure (e.g. `type: "plugin"`
on a collection) is a hard error.

Installed units never carry `agntc.json` on disk — it's an install-time input, stripped from the destination.

## Supported Agents

| Agent | Skills | Agents | Hooks |
|---|---|---|---|
| Claude | `.claude/skills/` | `.claude/agents/` | `.claude/hooks/` |
| Codex | `.agents/skills/` | — | — |
| Cursor | `.cursor/skills/` | — | — |

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
    "type": "plugin",
    "constraint": "^2.1.6"
  }
}
```

The `files` array enables clean removal and nuke-and-reinstall updates. The optional `constraint` field stores the semver range for constrained updates.

The optional `type` field (`"skill"` | `"plugin"`) records the resolved type so `update` replays it (re-installing the same kind) instead of blindly re-detecting — `update` validates the re-cloned tree still supports that type *before* deleting anything (derive-before-delete), and aborts with the install left intact if it doesn't. Legacy manifests without `type` backfill it from the recorded `files` on the next read. A skills-only collection member may also carry an internal `sourceSubpath` recording where in the repo to re-copy it from.

## License

MIT
