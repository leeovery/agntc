---
topic: core-system
status: concluded
type: feature
date: 2026-02-12
sources:
  - name: core-architecture
    status: incorporated
  - name: multi-agent-support
    status: incorporated
  - name: config-file-simplification
    status: incorporated
  - name: cli-commands-ux
    status: incorporated
  - name: deferred-items-triage
    status: incorporated
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

**Validation:**
- Invalid JSON → error and abort: "Invalid agntc.json: {parse error}"
- Missing `agents` field → error and abort: "Invalid agntc.json: agents field is required"
- Empty `agents` array → error and abort: "Invalid agntc.json: agents must not be empty"
- Unknown agent identifier → warn, continue. Ignore the unknown value during routing. Future-proofs against plugins declaring agents the tool doesn't support yet.

- No `type` field — skill vs plugin vs collection is inferred from directory structure (see Type Detection)
- No default-to-all — author explicitly declares which agents they support
- No inheritance — every installable unit declares its own `agents`, even within collections
- No collection-level config — collections have no root `agntc.json`

### Type Detection

The tool infers what it's looking at from structure, not declarations:

1. **Root has `agntc.json`** → standalone installable
   - Has asset dirs (`skills/`, `agents/`, `hooks/`) → **plugin** (scan and route). If `SKILL.md` also exists at root, warn: root `SKILL.md` is ignored when asset directories are present — this is likely a misconfigured plugin.
   - Has `SKILL.md` at root (no asset dirs) → **skill** (copy directory as a skill)
   - Neither → warn (config exists but nothing to install)

2. **Root has no `agntc.json`** → scan immediate subdirs for `agntc.json` → those are selectable installables (**collection**)

3. **Nothing** → not an agntc repo

If rule 2 scans subdirs and finds no `agntc.json` in any of them, this falls through to rule 3 — not an agntc repo.

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
4. If `SKILL.md` found → bare skill — copy the entire plugin directory as a skill, named after the source directory (e.g., `go-development/` → `.claude/skills/go-development/`). Exclude `agntc.json` from the copy.
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

The `.agntc/` directory and `manifest.json` file are created automatically on first install if they don't exist.

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

For local path installs, `ref` and `commit` are both `null`. The manifest key format (absolute path vs `owner/repo`) distinguishes local installs from git HEAD installs.

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

Installs plugins from a git repo. One source per invocation.

#### Source Argument

Always required (no no-arg mode). One source per invocation.

**Supported formats:**

| Format | Example | Notes |
|--------|---------|-------|
| GitHub shorthand | `owner/repo`, `owner/repo@v2.0` | Primary format. `@ref` for tag or branch. |
| HTTPS URL | `https://github.com/owner/repo`, `https://gitlab.com/org/repo` | Any git host. |
| SSH URL | `git@github.com:owner/repo.git` | For SSH auth setups. |
| Local path | `./my-plugin`, `/absolute/path`, `~/my-plugin` | For local development/testing. No git clone — files copied directly. |
| Direct path to plugin | `https://github.com/owner/repo/tree/main/plugin-name` | Collection shortcut — skips plugin multiselect, installs the specified plugin directly. Ref is embedded in the URL path. |

**Version pinning:** All formats except direct path and local path support `@ref` suffix (e.g., `owner/repo@v2.0`, `https://gitlab.com/org/repo@v2.0`). Direct path URLs carry the ref in the URL structure (`/tree/{ref}/...`). Local paths have no ref concept. When no ref is specified, HEAD is used.

**Direct path behavior:** When a source points to a specific plugin within a collection (via tree URL path), the tool skips the collection multiselect and installs that plugin directly. The remainder of the flow (agent selection, collision check, copy) proceeds as normal.

**Manifest key derivation:** Owner and repo are extracted from any format and used as the manifest key (`owner/repo` for standalone, `owner/repo/plugin-name` for collection plugins) regardless of source format. For local paths, the resolved absolute path is the manifest key (e.g., `/Users/lee/Code/my-plugin`). Collection plugins from local paths use `{absolute-path}/{plugin-name}`. `~` is expanded before storing.

#### Full Flow

1. **Parse source argument** (shorthand / URL / local path / direct path)
2. **Clone repo** (shallow) or copy from local path
3. **Read `agntc.json`** → determine skill vs plugin vs collection via type detection rules
4. **If collection**: multiselect plugins. Already-installed plugins are marked but still selectable — selecting one triggers a reinstall. No separate `--force` flag.
5. **Agent multiselect**: always shown, all supported agents listed. Pre-select detected ∩ compatible. Unsupported agents shown with warning.

**Empty selections**: If the user selects zero plugins (collection multiselect) or zero agents (agent multiselect), treat as cancel — display a brief message and exit cleanly. No error.

6. **Reinstall handling**: for any selected plugin that is already installed, delete all files listed in its manifest `files` array before proceeding. This ensures a clean slate — no orphaned files from the previous version and no conflict prompts against the plugin's own existing assets. Same mechanics as update's nuke step.
7. **File path collision check**: diff incoming file list against all existing manifest entries. Hard block if any path overlaps with another plugin (see File Path Collisions).
8. **Unmanaged file conflict check**: scan destination paths against disk for unmanaged files. Per-plugin prompt: overwrite all or cancel plugin (see Conflict Handling).
9. **For each plugin × each agent**: route assets via driver config, copy to target directories.
10. **Write manifest**: new entries (replacing any reinstalled entries). Single atomic write.
11. **Show summary**: per-agent asset counts. Note any plugins skipped due to conflicts.
12. **Clean up** temp clone dir (git sources only)

#### Conflict Handling

After the file path collision check (step 7) and before any copying, scan each plugin's destination paths against disk for unmanaged files (files that exist but aren't tracked in any plugin's manifest — e.g., manually placed by the user). Conflicts with other plugins' managed files are caught earlier by the file path collision check.

Conflicts are detected at the **asset level**, not file level:
- Skill directory exists → one conflict
- Agent file exists → one conflict
- Hook file exists → one conflict

If conflicts are found for a plugin, show all conflicting assets and offer two options:
- **Overwrite all** — nuke the conflicting assets entirely and replace. No merging, no diffing. Requires a second confirmation ("Are you sure? These files will be permanently replaced.") before proceeding.
- **Cancel this plugin's install**

Plugins are atomic — overwrite everything or install nothing. No partial installs.

For **collections with multiple selected plugins**, each plugin is checked independently. Plugins with no conflicts proceed normally. Plugins the user cancels are excluded. Summary notes which plugins were skipped due to conflicts.

All conflict resolution happens before copying begins, so no rollback is needed.

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

**Empty manifest**: If no plugins are installed, display "No plugins installed." and exit.

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

**Empty manifest**: If no plugins are installed, display "No plugins installed." and exit.

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

#### Local Path Updates

Local path plugins always re-copy from the stored path. No change detection — the tool cannot determine if local files have changed, so update always performs the copy. This makes `update` useful during local plugin development as a quick "refresh from source."

#### Agent Compatibility Changes

During update, the tool re-reads the new version's `agntc.json` and compares its `agents` field against the manifest entry's `agents` list.

**If agents were dropped by the author:**

1. Warn: "Plugin `{key}` no longer declares support for `{dropped_agent}`. Currently installed for: `{manifest agents}`. New version supports: `{new agents}`."
2. Proceed with update but only install for agents still in the new `agents` list
3. Dropped agent's files are removed as part of the nuke and not re-created
4. Manifest entry's `agents` field is updated to reflect what was actually installed
5. Summary shows: "Updated for Claude. Codex support removed by plugin author — Codex files removed."

**If all installed agents were dropped:** the update effectively becomes a removal. Warn and skip: "Plugin `{key}` no longer supports any of your installed agents. No update performed. Run `npx agntc remove {key}` to clean up." Existing files are left in place — the user decides when to remove.

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
| Local install | `● Local` | Default |

No remote check performed for local installs.

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
| Local | Update, Remove, Back |

**Change version**: presents a selectable list of available tags. User picks one → nuke-and-reinstall at the new tag. Manifest updated with new ref + commit. Same mechanics as update but with a new ref.

#### Post-Action Behaviour

- **After Update / Change version**: remain in the detail view with refreshed information and a success indicator showing the new version
- **After Remove**: return to the list with a confirmation message. The removed plugin is no longer in the list.
- **After Back**: return to the list

#### Update Check

Parallel `git ls-remote` calls behind a single spinner. Responsive for typical install sizes (2-10 plugins).

### Command Argument Validation

When `remove` or `update` is called with a plugin key that doesn't match any manifest entry:

- Display error: "Plugin {key} is not installed."
- Exit with non-zero status code
- No suggestions, no retry

When `add` is called with a source that can't be resolved (invalid shorthand, unreachable URL):

- Display the git error clearly
- Exit with non-zero status code

## Error Handling

### Network/Git Errors (Clone Failures)

- Retry up to 3 times on transient failures (network timeout, temporary git errors)
- After retries exhausted: surface the git error clearly, abort. Nothing to clean up — no files copied yet.
- Auth failures (private repo, bad credentials): no retry — surface the error immediately. The tool doesn't handle auth; it defers to the user's git configuration.

### Partial Failure During Copy (Single Plugin)

Rollback to clean state. Delete everything copied so far for this plugin, write no manifest entry. A half-installed plugin is worse than no plugin.

The manifest `files` list (tracked in memory during copy) tells the tool exactly what to delete during rollback.

### Multi-Plugin Install (Collection With Multiple Selections)

Each plugin is independent. If plugin 1 succeeds and plugin 2 fails (after retries), plugin 1 keeps its manifest entry. Plugin 2 is rolled back.

Summary shows per-plugin outcome: installed, failed (with error), skipped (user choice from conflicts).

### Rollback Edge Case

If a copy fails after overwriting a file owned by another plugin, rollback deletes the new copy but the previous plugin's asset is already gone. Accepted as a narrow edge case — user can `update` the previous plugin to restore its files.

## Existing Plugin Migration

No special migration tooling needed. agntc's overwrite-on-conflict behaviour handles it:

1. User runs `npx agntc add owner/repo` — agntc installs files, overwrites any existing copies from the previous tool, creates manifest entry
2. User manually removes the previous tool (e.g., `npm uninstall claude-manager`)

Cleaning up another tool's artifacts is the user's responsibility and out of scope for agntc.

## Dependencies

No internal system dependencies. agntc is a standalone CLI tool.

**Runtime prerequisites** (not build dependencies):
- Git — required for clone, ls-remote operations. Expected to be available on the user's system.
- npm — distribution channel (`npx agntc`). Standard Node.js toolchain.
