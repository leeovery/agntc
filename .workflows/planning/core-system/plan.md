---
topic: core-system
status: concluded
format: tick
ext_id: tick-20aa13
specification: ../../specification/core-system/specification.md
cross_cutting_specs:
  - ../../specification/naming-and-identity.md
spec_commit: fbcc1fda1d7e7d0c45b13fb9a88019b5e1b1cb48
created: 2026-02-18
updated: 2026-02-20
external_dependencies: []
task_list_gate_mode: auto
author_gate_mode: auto
finding_gate_mode: auto
review_cycle: 4
planning:
  phase: 10
  task: ~
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
ext_id: tick-aed71e
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
| cs-2-1 | Multi-Asset Plugin Asset Copier | empty asset dir, subset of asset types present, nested subdirectories within asset dirs | authored | tick-a4cc6d |
| cs-2-2 | Add Command: Multi-Asset Plugin Integration | misconfiguration warning (root SKILL.md ignored), empty plugin warning (no assets) | authored | tick-456e1a |
| cs-2-3 | Collection Plugin Multiselect UI | no subdirs have agntc.json (not-an-agntc-repo fallthrough), all plugins already installed, single plugin in collection | authored | tick-46b8a2 |
| cs-2-4 | Add Command: Collection Integration | mixed plugin types within collection, plugin-level agntc.json validation failure | authored | tick-f68023 |
| cs-2-5 | Reinstall on Reselect | manifest files no longer on disk, reinstalling with different agent selection | authored | tick-5820dd |

### Phase 3: Multi-Agent Support and Source Formats
status: approved
ext_id: tick-ef070a
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

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-3-1 | Codex Agent Driver | none | authored | tick-3f18d0 |
| cs-3-2 | Agent Detection System | project dir exists but empty, which command not found, both project and system absent | authored | tick-947bd2 |
| ~~cs-3-3~~ | ~~Agent Multiselect with Pre-Selection and Warnings~~ | ~~merged into cs-3-1~~ | cancelled | tick-1abe95 |
| cs-3-4 | Source Parsing: HTTPS URL | URL with trailing slash, URL with .git suffix, non-GitHub hosts | authored | tick-d63c08 |
| cs-3-5 | Source Parsing: SSH URL | missing .git suffix, non-standard SSH port syntax | authored | tick-448957 |
| cs-3-6 | Source Parsing: Local Path | path does not exist, path is a file not directory, tilde expansion | authored | tick-db20a7 |
| cs-3-7 | Source Parsing: Direct Collection Path | nested plugin path, ref containing slashes, tree URL with @ref suffix (invalid) | authored | tick-0b36b0 |
| cs-3-8 | Local Path Source Integration | local collection plugins (key as absolute-path/plugin-name), local path with no agntc.json | authored | tick-d24318 |
| cs-3-9 | File Path Collision Check | collision with multiple plugins, reinstall case (own files excluded) | authored | tick-400db7 |
| cs-3-10 | Unmanaged File Conflict Check | directory exists but empty, collections with mixed conflict/no-conflict plugins, all plugins cancelled | authored | tick-081566 |
| cs-3-11 | Add Command: Full Conflict Flow Integration | conflict resolution then successful installs in same batch, plugin cancelled after collision resolution removed another plugin | authored | tick-f5b1ac |

### Phase 4: Remove and Update Commands
status: approved
ext_id: tick-d85f8a
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

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-4-1 | Remove Command: Parameterized Mode | non-existent plugin key (error + non-zero exit), empty manifest, collection prefix removing all matching plugins | authored | tick-35621c |
| cs-4-2 | Remove Command: Interactive Mode | empty manifest, single plugin installed | authored | tick-5bc8a9 |
| cs-4-3 | Update Check Logic | git ls-remote network failure, tag with no newer tags, branch no longer exists on remote | authored | tick-76e6c7 |
| cs-4-4 | Update Command: Single Plugin Nuke-and-Reinstall | plugin files already deleted from disk, non-existent plugin key (error + non-zero exit), empty manifest | authored | tick-2a89a4 |
| cs-4-5 | Update Command: Local Path Re-Copy | stored path no longer exists, stored path no longer has agntc.json | authored | tick-a1ef32 |
| cs-4-6 | Update Command: Tag-Pinned Behavior | no tags on remote, hundreds of tags | authored | tick-496cae |
| cs-4-7 | Update Command: Agent Compatibility Changes | all installed agents dropped (warn + skip), new agents added by author (ignored) | authored | tick-027b1d |
| cs-4-8 | Update Command: All-Plugins Mode | mix of HEAD/branch/tag/local plugins, some fail while others succeed, all already up-to-date | authored | tick-7c0be9 |
| ~~cs-4-9~~ | ~~Update Command: Network Retry~~ | ~~merged into cs-4-4~~ | cancelled | tick-4ec9ff |
| cs-4-10 | Update and Remove Output Formatting | tag-pinned newer versions output, already up-to-date acknowledgment, agent compatibility change summary | authored | tick-32d35f |

### Phase 5: List Dashboard and Error Hardening
status: approved
ext_id: tick-71886c
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

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-5-1 | Parallel Update Check for All Plugins | network timeout on one plugin while others succeed, local installs skipped, empty manifest | authored | tick-0f3e21 |
| cs-5-2 | List View: Plugin List with Status Indicators | all plugins local (no spinner needed), single plugin installed, very long plugin keys | authored | tick-b0cb9a |
| cs-5-3 | Detail View: Plugin Information Display | plugin with null ref and null commit (local), plugin with many files | authored | tick-d19707 |
| cs-5-4 | Detail View: Update Action | update check previously failed but user triggers update, network failure during update | authored | tick-9d07b8 |
| cs-5-5 | Detail View: Remove Action | last plugin removed (return to empty state), files already deleted from disk | authored | tick-ba9807 |
| cs-5-6 | Detail View: Change Version Action | no tags available, selected tag same as current, hundreds of tags | authored | tick-39a172 |
| cs-5-7 | List Navigation Loop | remove last plugin then return to list, rapid successive actions | authored | tick-bb6c3b |
| cs-5-8 | Partial Copy Failure Rollback | rollback failure (file locked), overwritten file from another plugin cannot be restored | authored | tick-95a48e |
| cs-5-9 | Multi-Plugin Independent Failure Handling | all plugins fail, first succeeds but second fails, conflict-skipped alongside failed | authored | tick-e908a4 |
| cs-5-10 | Comprehensive Summary Output | mix of installed/failed/skipped outcomes, single plugin operations | authored | tick-1028ba |

### Phase 6: Analysis (Cycle 1)
status: approved
ext_id: tick-9b3876

**Goal**: Address findings from Analysis (Cycle 1).

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-6-1 | Extract shared nuke-and-reinstall pipeline | none | authored | tick-7180d4 |
| cs-6-2 | Add collection prefix matching to update command | none | authored | tick-cf8b24 |
| cs-6-3 | Fix nuke-before-copy data loss risk on copy failure | none | authored | tick-a00a08 |
| cs-6-4 | Strengthen type safety for AssetType, AgentId, and AgentWithDriver | none | authored | tick-8387d9 |
| cs-6-5 | Store original clone URL in manifest to fix non-GitHub update flows | none | authored | tick-42ff1b |
| cs-6-6 | Fix config validation error messages to include spec-required prefix | none | authored | tick-c04b35 |
| cs-6-7 | Fix computeIncomingFiles granularity for plugin collision/unmanaged checks | none | authored | tick-a4046d |
| cs-6-8 | Extract shared isNodeError type guard | none | authored | tick-a3306f |
| cs-6-9 | Extract shared execGit helper | none | authored | tick-6b7df4 |
| cs-6-10 | Extract shared buildParsedSource and getSourceDir helpers | none | authored | tick-8fe97c |
| cs-6-11 | Add filesystem-based integration tests for core workflows | none | authored | tick-ed706d |

### Phase 7: Analysis (Cycle 2)
status: approved
ext_id: tick-d00910

**Goal**: Address findings from Analysis (Cycle 2).

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-7-1 | Extract shared clone-and-reinstall orchestration | none | authored | tick-b51c55 |
| cs-7-2 | Centralize clone URL derivation and add cloneUrl to GitHubShorthandSource | none | authored | tick-dc4981 |
| cs-7-3 | Fix collection add to enforce per-plugin agent compatibility warnings | none | authored | tick-b999e1 |
| cs-7-4 | Extract shared readDirEntries utility | none | authored | tick-56138f |
| cs-7-5 | Consolidate findDroppedAgents as complement of computeEffectiveAgents | none | authored | tick-e6bbde |
| cs-7-6 | Align summary output format with spec | none | authored | tick-72799f |

### Phase 8: Analysis (Cycle 3)
status: approved
ext_id: tick-64fe90

**Goal**: Address findings from Analysis (Cycle 3).

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-8-1 | Extract failure-reason mapper and unify update orchestration functions | none | authored | tick-e16f38 |
| cs-8-2 | Extract local path validation helper | none | authored | tick-90df13 |
| cs-8-3 | Extract readManifestOrExit helper | none | authored | tick-902b4f |
| cs-8-4 | Extract errorMessage utility function | none | authored | tick-99a33c |
| cs-8-5 | Narrow tree URL @ref rejection to path portion only | none | authored | tick-a36a34 |

### Phase 9: Analysis (Cycle 4)
status: approved
ext_id: tick-f05a59

**Goal**: Address findings from Analysis (Cycle 4).

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-9-1 | Unify runRemoteUpdate and runLocalUpdate in list-update-action.ts and internalize copy-failed manifest removal | none | authored | tick-6c1630 |
| cs-9-2 | Extract shared conflict-check pipeline in add.ts | none | authored | tick-75db2e |
| cs-9-3 | Extract withExitSignal wrapper for command actions | none | authored | tick-cfe67a |

### Phase 10: Analysis (Cycle 5)
status: approved
ext_id: tick-7d400b

**Goal**: Address findings from Analysis (Cycle 5).

#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| cs-10-1 | Derive agent/asset-type classification from driver registry instead of path substrings | none | authored | tick-5000e1 |
| cs-10-2 | Consolidate mapCloneFailure handler blocks between list-update-action.ts and list-change-version-action.ts | none | authored | tick-995708 |
| cs-10-3 | Deduplicate formatRef by reusing formatRefLabel from summary.ts | none | authored | tick-57e313 |
| cs-10-4 | Strengthen CollectionPluginResult.detectedType to use concrete DetectedType union | none | authored | tick-6f7201 |
