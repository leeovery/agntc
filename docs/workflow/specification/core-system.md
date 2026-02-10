---
topic: core-system
status: in-progress
type: feature
date: 2026-02-09
sources:
  - name: core-architecture
    status: pending
  - name: multi-agent-support
    status: pending
  - name: config-file-simplification
    status: pending
  - name: cli-commands-ux
    status: pending
  - name: deferred-items-triage
    status: pending
---

# Specification: Core System

## Overview

agntc is a standalone npx-based CLI tool that installs AI skills, agents, and hooks from git repos into projects. It supports multiple AI agents (Claude, Codex) through a driver/strategy architecture, uses a manifest to track installations, and provides four commands: `add`, `remove`, `update`, `list`.

This specification covers the full core system: plugin configuration, type detection, asset discovery and routing, multi-agent support, manifest management, all four CLI commands, error handling, and edge cases.

## Plugin Configuration

### `agntc.json`

Every installable unit must have an `agntc.json` at its root. The file's presence marks "I am installable." There is no convention fallback — repos without `agntc.json` are not agntc-installable.

**Schema:**

```json
{
  "agents": ["claude"]
}
```

Single required field:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agents` | `string[]` | Yes | Agent identifiers this plugin was built and tested for. Valid values: `"claude"`, `"codex"`. |

- No `type` field — skill vs plugin vs collection is inferred from directory structure (see Type Detection)
- No default-to-all — author explicitly declares which agents they support
- No inheritance — every installable unit declares its own `agents`, even within collections
- No collection-level config — collections have no root `agntc.json`

### Type Detection

The tool infers what it's looking at from structure, not declarations:

1. **Root has `agntc.json`** → standalone installable
   - Has `SKILL.md` at root → **skill** (copy directory as a skill)
   - Has asset dirs (`skills/`, `agents/`, `hooks/`) → **plugin** (scan and route)
   - Neither → warn (config exists but nothing to install)

2. **Root has no `agntc.json`** → scan immediate subdirs for `agntc.json` → those are selectable installables (**collection**)

3. **Nothing** → not an agntc repo

Collections are a structural observation, not a declared type. A collection is just a repo where the root has no config but subdirectories do.

### Structural Examples

**Bare skill:**
```
my-skill/
  agntc.json       ← {"agents": ["claude"]}
  SKILL.md
  reference.md
```

**Multi-asset plugin:**
```
my-plugin/
  agntc.json       ← {"agents": ["claude"]}
  skills/
    planning/SKILL.md
    review/SKILL.md
  agents/
    executor.md
  hooks/
    pre-commit.sh
```

**Collection:**
```
my-collection/
  README.md
  go/
    agntc.json     ← {"agents": ["claude", "codex"]}
    SKILL.md
  python/
    agntc.json     ← {"agents": ["claude"]}
    SKILL.md
  complex-tool/
    agntc.json     ← {"agents": ["claude"]}
    skills/
    agents/
    hooks/
```

## Asset Discovery and Routing

### Asset Types

| Asset Type | Description | Source Dir | Agents |
|-----------|-------------|------------|--------|
| Skills | AI skill directories with `SKILL.md` entrypoint | `skills/` | Claude, Codex |
| Agents | Agent definition files | `agents/` | Claude only |
| Hooks | Hook scripts | `hooks/` | Claude only |

### Discovery Within a Plugin

Once a plugin boundary is identified (via `agntc.json`), the tool scans inside it for assets:

1. Scan for recognized asset dirs: `skills/`, `agents/`, `hooks/`
2. If found → copy contents of each to the appropriate target dir per agent
3. If no asset dirs found → check for `SKILL.md` at plugin root
4. If `SKILL.md` found → bare skill — copy the entire plugin directory as a skill
5. If neither → nothing to install, warn

Everything else in the plugin (README, CLAUDE.md, package.json, agntc.json, etc.) is ignored. Only recognized asset dirs and bare skills get copied.

### Routing Per Agent

Each agent driver carries a config mapping asset type → target directory. Missing key = that asset type doesn't apply to this agent.

| Asset Type | Claude Target | Codex Target |
|-----------|---------------|--------------|
| skills | `.claude/skills/` | `.agents/skills/` |
| agents | `.claude/agents/` | — |
| hooks | `.claude/hooks/` | — |

Routing is a config lookup per driver — asset type in, target dir out (or null = skip). Adding new agents or updating target dirs is config-only, no routing logic changes.

No translation between agents. Copy what maps natively, skip what doesn't. Skills follow the same Agent Skills standard for both Claude and Codex — same `SKILL.md` entrypoint, same directory structure. Agents and hooks are Claude-only with no equivalent elsewhere.

## Multi-Agent Architecture

### Driver/Strategy Pattern

Each supported agent is a **driver** implementing a shared contract (TypeScript interface). The contract exposes methods for detection and routing. Each driver encapsulates its own heuristics — the tool loops through registered drivers and calls their methods.

Adding a new agent = write a new driver, register it. No changes to core logic.

### Agent Detection

Detection determines which agents the user has installed. Used to pre-select agents during `add`, not to gate installation.

**Strategy: project-level first, system-level fallback.** Cheapest check first, early returns throughout.

| Agent | Project Check | System Fallback |
|-------|--------------|-----------------|
| Claude | `.claude/` in project | `which claude` or `~/.claude/` |
| Codex | `.agents/` in project | `which codex` |

If project-level confirms an agent, skip the system check for that agent.

### Plugin ↔ Agent Compatibility

The author declares compatibility via the `agents` field in `agntc.json`. The tool respects the declaration but never blocks the user.

**Agent multiselect** is always shown during `add`, listing all supported agents (currently Claude, Codex). Never skipped, even if only one agent would be pre-selected.

**Pre-selection** is the intersection of two conditions:
1. The plugin declares support for the agent (in its `agents` field)
2. The agent is detected on the user's system

Both must be true for an agent to be pre-selected. Examples:
- Plugin declares `["claude", "codex"]`, user has both installed → both pre-selected
- Plugin declares `["claude", "codex"]`, user only has Claude → Claude pre-selected, Codex not pre-selected but available
- Plugin declares `["claude"]`, user has both installed → Claude pre-selected, Codex not pre-selected

**Unsupported agent warning**: Agents not listed in the plugin's `agents` field are still shown in the multiselect but display a warning indicating the plugin does not declare support for that agent — install at your own risk, it may not work. The user can still select it.

The user can always select any agent regardless of detection or compatibility. Warn, never block.

## Manifest

### Location and Purpose

`.agntc/manifest.json` in the consumer's project root. Tracks all installed plugins for `remove`, `update`, and `list` operations.

### Shape

Flat object keyed by install path. Every entry is a plugin — uniform shape regardless of whether it came from a standalone repo or a collection.

- Standalone plugin key: `owner/repo`
- Collection plugin key: `owner/repo/plugin-name`

Collection membership is implicit from the key prefix (e.g., `leeovery/agent-skills/go` → repo is `leeovery/agent-skills`).

### Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `string \| null` | What the user asked for — tag, branch, or `null` (default HEAD). Drives update semantics. |
| `commit` | `string` | Resolved SHA at install time. For comparison against remote. |
| `installedAt` | `string` | ISO 8601 timestamp. Informational. |
| `agents` | `string[]` | Which agents this was installed for. |
| `files` | `string[]` | Exact destination paths of copied files/dirs. Used for clean removal and nuke-and-reinstall updates. |

### Example

```json
{
  "leeovery/claude-technical-workflows": {
    "ref": "v2.1.6",
    "commit": "abc123f",
    "installedAt": "2026-02-09T14:30:00Z",
    "agents": ["claude"],
    "files": [
      ".claude/skills/technical-planning/",
      ".claude/skills/technical-review/",
      ".claude/agents/task-executor.md"
    ]
  },
  "leeovery/agent-skills/go": {
    "ref": null,
    "commit": "def456a",
    "installedAt": "2026-02-09T14:30:00Z",
    "agents": ["claude", "codex"],
    "files": [
      ".claude/skills/go-development/",
      ".agents/skills/go-development/"
    ]
  }
}
```

### Nuke-and-Reinstall Update Strategy

Updates use nuke-and-reinstall rather than diffing:

1. Delete all files listed in the plugin's manifest `files` array
2. Re-clone at the same ref (or HEAD for null ref)
3. Re-copy using the same agents from the manifest entry
4. Update manifest with new commit SHA and file list

This handles all edge cases cleanly — asset renames, deletions, moved files between versions — without any special logic. The manifest always reflects what's actually on disk after the operation.

## Commands

All commands use @clack/prompts for interactive UI. All are invoked via `npx agntc <command>`.

### `add`

Installs plugins from a git repo or local path. One source per invocation.

#### Source Argument

Always required (no no-arg mode). Three formats:

| Format | Example |
|--------|---------|
| GitHub shorthand | `owner/repo`, `owner/repo@v2.0`, `owner/repo@branch-name` |
| Full git URL | `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git` |
| Local path | `/absolute/path` or `./relative/path` — for development/testing without pushing to git |

#### Full Flow

1. **Parse source argument** (shorthand / URL / local path)
2. **Clone repo** (shallow) or resolve local path
3. **Read `agntc.json`** → determine skill vs plugin vs collection via type detection rules
4. **If collection**: multiselect plugins. Already-installed plugins are marked but still selectable — selecting one triggers a reinstall (nuke-and-reinstall, consistent with update strategy). No separate `--force` flag.
5. **Agent multiselect**: always shown, all supported agents listed. Pre-select detected ∩ compatible. Unsupported agents shown with warning.
6. **For each plugin × each agent**: route assets via driver config, copy with conflict handling (see below)
7. **Write manifest**: new entries + any ownership transfers from conflict resolution. Single atomic write.
8. **Show summary**: per-agent asset counts
9. **Clean up** temp clone dir

#### Conflict Handling

Conflicts are detected at the **asset level**, not file level:
- Skill directory exists → one prompt ("This skill already exists. Overwrite or skip?")
- Agent file exists → one prompt
- Hook file exists → one prompt

Overwrite = nuke the existing asset entirely and replace. No merging, no diffing.

**Manifest ownership transfer**: when overwriting an asset, check if the existing path is tracked in the manifest by another plugin. If so, remove that path from the previous owner's `files` list. If the previous owner's `files` becomes empty, clean up their manifest entry entirely. If the asset wasn't managed by agntc (manually placed), just overwrite — no manifest cleanup needed.

Ownership changes tracked in memory during the operation, manifest written once at the end.

#### File Path Collisions Across Plugins

Separate from asset-level conflict handling. Before any copying, diff the incoming file list against all existing manifest entries. If any path overlaps with a file owned by another plugin:

1. Show which files conflict and which plugin owns them
2. Offer exactly two options:
   - **Remove the conflicting plugin first, then continue** — tool handles both in one flow
   - **Cancel**

No "install anyway" option. Plugins are atomic with interdependent assets — overwriting one asset from a plugin breaks the whole plugin's internal wiring.

#### Summary Output

```
Installed leeovery/claude-technical-workflows@v2.1.6

  Claude:
    12 skills, 3 agents, 2 hooks

  Codex:
    12 skills
```

For collections, repeat per plugin. Only show asset types that were actually installed (no "0 hooks" lines).

### `remove`

Deletes installed plugins and their manifest entries. Both interactive and parameterized.

#### Invocation

| Mode | Command | Behaviour |
|------|---------|-----------|
| No-arg interactive | `npx agntc remove` | Read manifest, present all installed plugins, let user pick |
| Standalone plugin | `npx agntc remove owner/repo` | Remove the plugin |
| All from collection | `npx agntc remove owner/repo` | If key has multiple collection plugins, remove all |
| Specific collection plugin | `npx agntc remove owner/repo/plugin-name` | Remove that specific plugin |

#### Flow

1. Read manifest, identify target plugin(s) based on argument (or user selection)
2. Show files that will be deleted, ask for confirmation
3. Delete all files listed in the plugin's manifest `files` array
4. Remove the plugin entry from manifest
5. Write manifest
6. Show summary of what was removed

**Always confirm before deleting.** Show the file paths that will be removed, require explicit yes. Deletion is destructive — the confirmation step is the safety gate.

**No modification detection.** The tool doesn't track file checksums. If the user modified installed files and then removes the plugin, those modifications are gone. Git is the safety net.

**Empty directories**: left in place. Agent config dirs (`.claude/`, `.agents/`) should persist regardless. Cleaning up empty dirs adds logic for marginal benefit.

### `update`

Checks remote state and re-installs plugins when newer versions exist. No interactive picker — follows npm/brew convention.

#### Invocation

| Mode | Command | Behaviour |
|------|---------|-----------|
| Update all | `npx agntc update` | Update all installed plugins that can be updated |
| Specific plugin | `npx agntc update owner/repo` | Update specific plugin (or all from a collection) |
| Specific collection plugin | `npx agntc update owner/repo/plugin-name` | Update that specific plugin |

#### Update Check Per Plugin

Based on manifest `ref` and `commit`:

| Manifest `ref` | Meaning | Check | Result |
|----------------|---------|-------|--------|
| `null` | Installed from default HEAD | `git ls-remote` for HEAD SHA, compare to stored `commit` | Different → update available |
| `"dev"` (branch) | Installed from branch | `git ls-remote` for branch tip SHA, compare | Different → update available |
| `"v2.0"` (tag) | Pinned to tag | Tag resolves to same commit forever → always "up to date" | Check for newer tags via `git ls-remote --tags`, inform user |

Tag-pinned plugins are never auto-upgraded. User re-adds with the new tag explicitly.

#### Update Mechanics (Nuke-and-Reinstall)

1. Delete all files listed in the plugin's manifest `files` array
2. Re-clone at the same ref (or HEAD for null ref)
3. Re-copy using the same agents from the manifest entry
4. Update manifest with new commit SHA
5. No re-prompt for agent selection — update means "latest version of what I already have." Changing agents is a re-add.

**No confirmation prompt.** Unlike `remove`, update is non-destructive in intent — user is asking for newer versions of things they already want.

#### Output

- Updated plugins: old ref/SHA → new, asset counts per agent
- Already up to date: brief acknowledgment
- Tag-pinned with newer versions: list available tags, show re-add command

### `list`

Interactive management dashboard. View, update, remove — all inline.

#### Entry Point

`npx agntc list` — no args.

#### Empty State

If no plugins are installed: display "No plugins installed. Run `npx agntc add owner/repo` to get started." and exit.

#### Initial View

1. Spinner: "Checking for updates..." — parallel `git ls-remote` checks for all installed plugins
2. Show all plugins as a selectable list with "Done" at the bottom:

```
  leeovery/claude-technical-workflows@v2.1.6    ✓ Up to date
  leeovery/agent-skills/go                      ↑ Update available
  leeovery/agent-skills/python@v1.0             ⚑ Newer tags available
  leeovery/other-plugin                         ✗ Check failed

  Done
```

Each row shows: plugin key + ref (tag/branch if pinned, nothing if HEAD), status indicator.

**Status indicators:**

| Status | Indicator | Colour |
|--------|-----------|--------|
| No update available | `✓ Up to date` | Default |
| Branch/HEAD with newer commit | `↑ Update available` | Green |
| Tag-pinned, newer tags on remote | `⚑ Newer tags available` | Yellow |
| Couldn't reach remote | `✗ Check failed` | Red |

Always show the list regardless of how many plugins are installed.

#### Detail View

User selects a plugin → detail view showing:
- Plugin key
- Ref (tag, branch, or HEAD)
- Commit SHA
- Install date
- Agents installed for
- Asset counts per agent
- Full file list

**Actions vary by update status:**

| Update Status | Actions |
|---------------|---------|
| Update available | Update, Remove, Back |
| Up to date | Remove, Back |
| Newer tags available | Change version, Remove, Back |
| Check failed | Remove, Back |

**Change version**: presents a selectable list of available tags. User picks one → nuke-and-reinstall at the new tag. Manifest updated with new ref + commit. Same mechanics as update but with a new ref.

#### Post-Action Behaviour

- **After Update / Change version**: remain in the detail view with refreshed information and a success indicator showing the new version
- **After Remove**: return to the list with a confirmation message. The removed plugin is no longer in the list.
- **After Back**: return to the list

#### Update Check

Parallel `git ls-remote` calls behind a single spinner. Responsive for typical install sizes (2-10 plugins).
