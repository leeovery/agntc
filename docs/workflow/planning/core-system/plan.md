---
topic: core-system
status: planning
format: tick
ext_id: tick-20aa13
specification: ../../specification/core-system/specification.md
cross_cutting_specs:
  - ../../specification/naming-and-identity.md
spec_commit: fbcc1fda1d7e7d0c45b13fb9a88019b5e1b1cb48
created: 2026-02-18
updated: 2026-02-18
external_dependencies: []
task_list_gate_mode: auto
author_gate_mode: auto
finding_gate_mode: gated
planning:
  phase: 2
  task: 1
---

# Plan: Core System

### Phase 1: Walking Skeleton - Add a Bare Skill from Git
status: approved
ext_id: tick-dea5ee
approved_at: 2026-02-18

**Goal**: Prove the end-to-end architecture by installing a single bare skill from a GitHub shorthand source for one agent (Claude), writing a manifest entry, and confirming via list output. This establishes the CLI entry point (commander + @clack/prompts), source parsing, git shallow clone, `agntc.json` validation, type detection, the agent driver interface with the Claude driver, file copy with `agntc.json` exclusion, manifest creation, and a minimal `list` output.

**Why this order**: This is the walking skeleton — the thinnest possible vertical slice threading through every system layer. It validates the entire architecture (CLI framework, git integration, config parsing, type detection, driver/strategy pattern, file routing, manifest persistence) at the cheapest moment. Every subsequent phase extends this working foundation rather than building in isolation.

**Acceptance**:
- [ ] `npx agntc add owner/repo` clones a repo containing a bare skill with `agntc.json`, copies it to `.claude/skills/{name}/` (excluding `agntc.json`), and writes `.agntc/manifest.json`
- [ ] `npx agntc list` reads the manifest and displays installed plugins with key and basic info
- [ ] `agntc.json` validation: missing file errors ("not an agntc repo"), invalid JSON errors with parse details, missing `agents` field errors, empty `agents` array errors, unknown agent identifiers warn and continue
- [ ] Type detection correctly identifies a bare skill (root `agntc.json` + `SKILL.md`, no asset dirs)
- [ ] Claude agent driver routes skills to `.claude/skills/`
- [ ] Agent multiselect is shown (Claude only at this stage) with pre-selection based on detection intersection compatibility
- [ ] Manifest entry contains `ref`, `commit`, `installedAt`, `agents`, and `files` fields with correct values
- [ ] `.agntc/` directory and `manifest.json` created automatically on first install
- [ ] Temp clone directory cleaned up after install

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-1-1 | Project Scaffolding and CLI Entry Point | none | authored | tick-0ba43c |
| cs-1-2 | Source Argument Parsing (GitHub Shorthand) | missing owner or repo segment, @ref with empty string, extra slashes | authored | tick-be4c96 |
| cs-1-3 | Git Shallow Clone | clone failure (nonexistent repo), temp dir cleanup on error | authored | tick-3dff00 |
| cs-1-4 | agntc.json Validation | missing file, invalid JSON, missing agents field, empty agents array, unknown agent identifiers | authored | tick-5024dd |
| cs-1-5 | Type Detection (Bare Skill) | agntc.json but no SKILL.md and no asset dirs, SKILL.md with asset dirs (warning) | authored | tick-3f9f32 |
| cs-1-6 | Agent Driver Interface and Claude Driver | no .claude/ dir and no system claude | authored | tick-cc248f |
| cs-1-7 | Agent Multiselect UI | zero selection (cancel), unsupported agent warning | authored | tick-e86117 |
| cs-1-8 | Bare Skill File Copy | destination directory already exists, empty skill directory | authored | tick-601f31 |
| cs-1-9 | Manifest Creation and Write | .agntc/ already exists, manifest.json already exists with other entries | authored | tick-aaa446 |
| cs-1-10 | Add Command End-to-End Integration | none | authored | tick-d7ffd9 |
| cs-1-11 | List Command (Minimal) | no manifest file, empty manifest, malformed manifest | authored | tick-15542a |

### Phase 2: Multi-Asset Plugins and Collection Support
status: approved
ext_id:
approved_at: 2026-02-18

**Goal**: Extend type detection and asset discovery to handle multi-asset plugins (repos with `skills/`, `agents/`, `hooks/` directories) and collections (repos where subdirectories contain their own `agntc.json`). Implement the collection multiselect UI and reinstall-on-reselect behavior.

**Why this order**: Phase 1 proved the architecture with the simplest structural variant (bare skill). This phase completes the structural coverage — all three plugin shapes (bare skill, multi-asset plugin, collection) — before introducing additional source formats or agent drivers. Type detection and asset discovery are foundational; everything else builds on them.

**Acceptance**:
- [ ] Multi-asset plugins: `skills/`, `agents/`, `hooks/` directories discovered and contents copied to correct Claude target directories
- [ ] Collections detected when root has no `agntc.json` but immediate subdirs do; presented as multiselect
- [ ] Already-installed collection plugins marked in multiselect; selecting one triggers reinstall (nuke existing files from manifest before copy)
- [ ] Bare skill with asset dirs present triggers misconfiguration warning ("root SKILL.md is ignored when asset directories are present")
- [ ] Empty plugin (`agntc.json` present but no asset dirs and no `SKILL.md`) produces a warning
- [ ] No root `agntc.json` and no subdir configs falls through to "not an agntc repo" error
- [ ] Each collection plugin gets its own manifest entry keyed as `owner/repo/plugin-name`
- [ ] Summary output shows per-agent asset counts (skills, agents, hooks — only types that were installed)

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-2-1 | Multi-Asset Plugin Asset Copier | empty asset dir, subset of asset types present, nested subdirectories within asset dirs | pending | |
| cs-2-2 | Add Command: Multi-Asset Plugin Integration | misconfiguration warning (root SKILL.md ignored), empty plugin warning (no assets) | pending | |
| cs-2-3 | Collection Plugin Multiselect UI | no subdirs have agntc.json (not-an-agntc-repo fallthrough), all plugins already installed, single plugin in collection | pending | |
| cs-2-4 | Add Command: Collection Integration | mixed plugin types within collection, plugin-level agntc.json validation failure | pending | |
| cs-2-5 | Reinstall on Reselect | manifest files no longer on disk, reinstalling with different agent selection | pending | |

### Phase 3: Multi-Agent Support and Source Formats
status: approved
ext_id:
approved_at: 2026-02-18

**Goal**: Implement the Codex agent driver, the full agent detection system (project-level first, system-level fallback), the agent multiselect with pre-selection and unsupported-agent warnings, all remaining source formats (HTTPS URL, SSH URL, local path, direct collection path, `@ref` pinning), and the complete conflict handling flows (file path collisions across plugins, unmanaged file conflicts).

**Why this order**: Phases 1-2 established type detection and asset routing through the Claude driver. This phase completes the `add` command by introducing the second agent driver, the full agent selection UX, all source format parsing, and the conflict resolution paths. After this phase, `add` is production-complete.

**Acceptance**:
- [ ] Codex agent driver routes skills to `.agents/skills/`, returns null for agents and hooks (skips them)
- [ ] Agent detection: project-level check first (`.claude/` for Claude, `.agents/` for Codex), system-level fallback (`which claude` / `~/.claude/` for Claude, `which codex` for Codex), early return on project-level match
- [ ] Agent multiselect always shown with all supported agents; pre-selection is intersection of plugin `agents` field and detected agents
- [ ] Unsupported agent warning shown for agents not in plugin's `agents` field; user can still select them
- [ ] HTTPS URL format parsed correctly (any git host)
- [ ] SSH URL format parsed correctly (`git@host:owner/repo.git`)
- [ ] Local path: no git clone, files copied directly, manifest key is resolved absolute path (`~` expanded), `ref` and `commit` both `null`
- [ ] Direct path (tree URL): extracts plugin name and ref from URL structure, skips collection multiselect, installs specified plugin directly
- [ ] `@ref` suffix works for GitHub shorthand and URL formats (tag or branch)
- [ ] File path collision check: incoming files diffed against all manifest entries; overlap with another plugin hard-blocks with two options (remove conflicting plugin then continue, or cancel)
- [ ] Unmanaged file conflict check: per-plugin prompt for overwrite-all (with second confirmation) or cancel-plugin; collections check each plugin independently
- [ ] Empty selection (zero plugins or zero agents) treated as cancel with brief message and clean exit

### Phase 4: Remove and Update Commands
status: approved
ext_id:
approved_at: 2026-02-18

**Goal**: Implement the `remove` command (interactive and parameterized modes) and the `update` command (all-plugins and specific-plugin modes) with nuke-and-reinstall mechanics, local path re-copy, tag-pinned behavior, agent compatibility change handling, and network retry logic.

**Why this order**: `add` is production-complete after Phase 3. `remove` and `update` operate on the manifest entries and installed files that `add` creates. They reuse source parsing, git operations, agent routing, and file copy infrastructure from prior phases. `update` shares nuke-and-reinstall mechanics with the reinstall flow already built in Phase 2.

**Acceptance**:
- [ ] `remove` no-arg: reads manifest, presents all installed plugins as selectable list, user picks one or more
- [ ] `remove` parameterized: `owner/repo` removes standalone plugin or all collection plugins with that prefix; `owner/repo/plugin-name` removes specific collection plugin
- [ ] `remove`: shows files to be deleted, requires explicit confirmation before deleting
- [ ] `remove`: deletes all files in manifest `files` array, removes manifest entry, writes manifest
- [ ] `remove`: empty manifest displays "No plugins installed." and exits
- [ ] `remove`: non-existent plugin key displays "Plugin {key} is not installed." with non-zero exit
- [ ] `update` no-arg: checks and updates all installed plugins
- [ ] `update` parameterized: works for `owner/repo` (standalone or all collection plugins) and `owner/repo/plugin-name`
- [ ] `update`: HEAD/branch plugins compared via `git ls-remote` SHA against stored `commit`; different SHA triggers nuke-and-reinstall with same agents
- [ ] `update`: tag-pinned plugins always report "up to date"; checks for newer tags via `git ls-remote --tags` and informs user with re-add command
- [ ] `update`: local path plugins always re-copy from stored path (no change detection)
- [ ] `update`: re-reads new `agntc.json` and handles agent compatibility changes — dropped agents warned, their files removed (not re-created), manifest `agents` updated
- [ ] `update`: if all installed agents dropped by author, warn and skip ("no update performed, run remove to clean up")
- [ ] `update`: no confirmation prompt
- [ ] `update`: non-existent plugin key displays error with non-zero exit
- [ ] `update`: empty manifest displays "No plugins installed." and exits
- [ ] Network/git errors: retry up to 3 times on transient failures; auth failures fail immediately with clear error
- [ ] `update` output: shows old ref/SHA to new, asset counts per agent; already up-to-date gets brief acknowledgment

### Phase 5: List Dashboard and Error Hardening
status: approved
ext_id:
approved_at: 2026-02-18

**Goal**: Build the full interactive `list` dashboard with parallel update checks, status indicators, detail view, inline actions (update, remove, change version), and post-action navigation. Harden error handling across all commands: partial copy failure rollback, multi-plugin independent failure handling, and comprehensive summary output.

**Why this order**: The list dashboard depends on both `add` (to have installed plugins) and `update`/`remove` (for inline actions). It is the capstone UI that ties all commands together. Error hardening is best done last because it crosses all commands and benefits from every happy path being stable. This is the refinement phase.

**Acceptance**:
- [ ] `list`: parallel `git ls-remote` calls behind a single spinner for all installed plugins
- [ ] `list`: displays all plugins as selectable list with status indicators — `Up to date`, `Update available` (green), `Newer tags available` (yellow), `Check failed` (red), `Local` (default)
- [ ] `list`: each row shows plugin key + ref (tag/branch if pinned, nothing if HEAD)
- [ ] `list`: "Done" option at bottom of list to exit
- [ ] `list`: selecting a plugin shows detail view (key, ref, commit SHA, install date, agents, asset counts per agent, full file list)
- [ ] `list`: detail view actions vary by status (update available: Update/Remove/Back; up to date: Remove/Back; newer tags: Change version/Remove/Back; check failed: Remove/Back; local: Update/Remove/Back)
- [ ] `list`: "Change version" presents selectable list of available tags; selection triggers nuke-and-reinstall at new tag with manifest updated
- [ ] `list`: after Update/Change version, remain in detail view with refreshed info and success indicator
- [ ] `list`: after Remove, return to list with confirmation message, removed plugin gone from list
- [ ] `list`: after Back, return to list
- [ ] `list`: empty state displays "No plugins installed. Run `npx agntc add owner/repo` to get started."
- [ ] Partial copy failure: rollback deletes everything copied so far for that plugin, no manifest entry written
- [ ] Multi-plugin install (collection): each plugin independent; successful plugins keep manifest entries, failed plugins rolled back
- [ ] Summary output shows per-plugin outcome: installed, failed (with error), skipped (user cancelled from conflicts)
- [ ] No remote check performed for local installs in list view
