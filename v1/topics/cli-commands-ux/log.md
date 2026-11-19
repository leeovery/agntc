## Discussion

---
topic: cli-commands-ux
status: concluded
work_type: greenfield
date: 2026-02-09
---

## Discussion: CLI Commands and UX — Add, Remove, Update, List

### Context

agntc has four core commands: `add`, `remove`, `update`, `list` (plus `init` discussed separately). All are manifest-driven, interactive via @clack/prompts, and share patterns around conflict handling and error states.

Prior discussions resolved the foundation these commands operate on:
- **Core architecture**: plugin/collection model, `agntc.json` as boundary marker, manifest shape (flat, keyed by install path, uniform plugin entries), convention-based asset discovery with bare skill fallback, nuke-and-reinstall update strategy
- **Multi-agent support**: driver/strategy pattern, two agents (Claude, Codex), three asset types (skills, agents, hooks), author-declared compatibility, warn-don't-block

Research mocked the `add` flow for unit/collection/re-add scenarios. `remove` mechanics are outlined (manifest-driven deletion, unit all-or-nothing, collection granular). `update` uses smart SHA comparison via `git ls-remote`. `list` is unexplored.

#### References

- [Research: exploration.md](../../discovery/session-001.md#research-exploration) (lines 183-201, 413-474)
- [Discussion: core-architecture.md](../core-architecture/log.md#discussion) — plugin/collection model, manifest shape, asset discovery
- [Discussion: multi-agent-support.md](../multi-agent-support/log.md#discussion) — detection, routing, compatibility

### Questions

- [x] What's the full `add` flow — from argument parsing through to manifest write?
- [x] How should `remove` work — interactive, parameterized, or both?
- [x] What are the `update` semantics — per-plugin, per-repo, all-at-once?
- [x] What should `list` show and how?
- [x] How should conflicts be handled across commands? *(covered in `add` flow — only command where conflicts arise)*
- [x] What does error handling look like — partial failures, network errors, git errors?

---

### What's the full `add` flow — from argument parsing through to manifest write?

#### Context

`add` is the primary command — the most complex flow and the one that establishes patterns the other commands build on. Research mocked three scenarios (unit install, collection install, re-add to collection) but left decision points unresolved.

#### Source argument formats

**Decision**: `add` accepts one source per invocation, always required (no no-arg mode). Three formats supported:

- **GitHub shorthand**: `owner/repo`, `owner/repo@v2.0`, `owner/repo@branch-name`
- **Full git URL**: `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git`
- **Local path**: `/absolute/path` or `./relative/path` — for plugin development/testing without pushing to git first

One source per invocation. Multiple plugins from a collection are selected interactively within the flow, not via multiple args.

#### Mode detection

After clone (or local path resolution), read root `agntc.json`:
1. `"type": "collection"` → collection mode — present plugin multiselect
2. `"type": "plugin"` or no type field → plugin mode — install everything
3. No `agntc.json` → convention fallback — scan for asset dirs at root, treat as plugin

#### Collection plugin selection

For collections, show a multiselect of all plugins in the collection. Already-installed plugins are marked but still selectable — selecting one triggers a reinstall (nuke-and-reinstall, consistent with update strategy). No separate `--force` flag needed.

#### Agent selection

**Decision**: Always show the multiselect of all supported agents (currently Claude, Codex). Never skip.

- **Pre-selected**: agents that are both detected (user has them installed) AND compatible (plugin's `agents` field includes them, or plugin has no `agents` field)
- **Not pre-selected but available**: all other supported agents
- **Never block**: user can select any agent regardless of detection or compatibility
- **No auto-select shortcut**: even if only one agent would be pre-selected, still show the multiselect. With multiple supported agents, the user should always see the full picture.

Initially considered auto-selecting when exactly one agent was detected + compatible. Rejected because it hides the option to install for other agents. Simpler rule: always show the multiselect, one code path.

#### Conflict handling during copy

**Decision**: Detect conflicts at the **asset level**, not file level. Prompt as encountered during copy.

- **Skill directory**: `skills/go-development/` exists → one prompt ("This skill already exists. Overwrite or skip?"), not 20 prompts for individual reference files
- **Agent file**: `agents/task-executor.md` exists → one prompt
- **Hook file**: same pattern

Overwrite = nuke the existing asset entirely and replace. No merging, no diffing.

Initially considered scanning all target paths upfront and presenting conflicts as a batch before copying. Rejected — the "as we go" approach is simpler and the asset-level granularity keeps prompt count manageable.

**Manifest ownership transfer**: when overwriting an asset, check if the existing path is tracked in the manifest by another plugin. If so, remove that path from the previous owner's `files` list. If the previous owner's `files` becomes empty, clean up their manifest entry entirely. If the asset wasn't managed by agntc (manually placed), just overwrite — no manifest cleanup needed.

Ownership changes tracked in memory during the operation, manifest written once at the end.

#### Manifest write

Single atomic write at the end of the `add` operation:
- Add new plugin entry (or entries for multiple collection plugins)
- Apply any ownership transfers from conflict resolution
- Write `.agntc/manifest.json` once

#### Summary

Show what was installed, broken down per agent:

```
Installed leeovery/claude-technical-workflows@v2.1.6

  Claude:
    12 skills, 3 agents, 2 hooks

  Codex:
    12 skills
```

For collections, repeat per plugin. Only shows asset types that were actually installed (no "0 hooks" for Codex).

#### Full flow summary

1. Parse source argument (shorthand / URL / local path)
2. Clone repo (shallow) or resolve local path
3. Read `agntc.json` → determine plugin vs collection
4. **If collection**: multiselect plugins (installed ones marked, re-selectable for reinstall)
5. Multiselect agents (pre-select detected ∩ compatible, all agents always available)
6. For each plugin × each agent: route assets via driver config, copy with asset-level conflict prompts
7. Write manifest (new entries + ownership transfers)
8. Show summary (per-agent asset counts)
9. Clean up temp clone dir

---

### How should `remove` work — interactive, parameterized, or both?

#### Context

Remove is manifest-driven — read what's installed, delete those files, update the manifest. Research outlined the basics but left invocation modes and edge cases unresolved.

#### Decision

**Both interactive and parameterized.**

**Parameterized** (power-user / scriptable):
- `npx agntc remove owner/repo` → remove a standalone plugin, or all plugins from a collection
- `npx agntc remove owner/repo/plugin-name` → remove a specific plugin from a collection

**No-arg interactive** (friendly path):
- `npx agntc remove` → read manifest, present all installed plugins, let user pick which to remove

**Always confirm before deleting.** Show the file paths that will be removed, require explicit yes. Deletion is destructive — the confirmation step is the safety gate.

**No modification detection.** The tool doesn't track file checksums. If the user modified installed files and then removes the plugin, those modifications are gone. Git is the safety net — if they committed their changes, they can recover. Considered detecting modifications but rejected: adds complexity (need to store checksums at install time, compare on remove) for a scenario that git already handles. The confirmation prompt is sufficient.

**Mechanics:**
1. Read manifest, identify target plugin(s) based on argument (or user selection)
2. Show files that will be deleted, ask for confirmation
3. Delete all files listed in the plugin's manifest `files` array
4. Remove the plugin entry from manifest
5. Write manifest
6. Show summary of what was removed

**Collection removal via `owner/repo`**: when the user specifies a repo key that has multiple collection plugins installed, remove all of them. This is the "nuke the whole collection" path. The confirmation step shows everything that will go.

**Empty directories**: leave them. Agent config dirs (`.claude/`, `.agents/`) should persist regardless. Cleaning up empty dirs adds logic for marginal benefit.

---

### What are the `update` semantics — per-plugin, per-repo, all-at-once?

#### Context

Update needs to check remote state, compare to stored state, and re-install when newer versions exist. Research proposed smart SHA comparison via `git ls-remote`. Key decisions: invocation granularity, how tag-pinned plugins are handled, and whether agent selection is re-prompted.

#### Decision

**No-arg updates everything. Parameterized for selective updates.** Like npm/brew — no interactive picker.

**Invocation:**
- `npx agntc update` → update all installed plugins that can be updated
- `npx agntc update owner/repo` → update specific plugin (or all from a collection)
- `npx agntc update owner/repo/plugin-name` → update specific collection plugin

**Update check per plugin (based on manifest `ref` and `commit`):**
- **`ref: null`** (installed from default HEAD) → `git ls-remote` for HEAD SHA, compare to stored `commit`. Different → update available.
- **`ref: "dev"`** (branch) → `git ls-remote` for branch tip SHA, compare. Different → update available.
- **`ref: "v2.0"`** (tag) → tag resolves to same commit forever. Always "up to date." But: check for newer tags (`git ls-remote --tags`) and inform the user. Don't auto-upgrade — user re-adds with the new tag explicitly.

Initially considered semver range support (`^2.0`, `~2.0`) like npm. Rejected — plugins are independent (no transitive dependencies), so the primary use case for ranges doesn't exist. Semver resolution is complex and we don't need it. Can revisit later if demand materialises.

**Update mechanics (nuke-and-reinstall):**
1. Delete all files listed in the plugin's manifest `files` array
2. Re-clone at the same ref (or HEAD for null ref)
3. Re-copy using the same agents from the manifest entry
4. Update manifest with new commit SHA
5. No re-prompt for agent selection — update means "latest version of what I already have." Changing agents is a re-add.

**No confirmation prompt.** Unlike `remove`, update is non-destructive in intent — user is asking for newer versions of things they already want. The nuke-and-reinstall is an implementation detail, not a user-facing concern.

**Output** shows per-plugin status (actual styling via @clack/prompts):
- Updated plugins: old ref/SHA → new, asset counts per agent
- Already up to date: brief acknowledgment
- Tag-pinned with newer versions: list available tags, show re-add command

---

### What should `list` show and how?

#### Context

`list` was completely unexplored in research. The manifest has all the data — plugin keys, refs, commits, agents, file paths. Question is what to show and how interactive to make it.

#### Journey

Initially considered a simple read-only dump of manifest state. But the manifest already has everything needed to build a richer experience — update availability, per-agent breakdowns, file listings. And with @clack/prompts providing `select()` and `spinner()`, an interactive approach is achievable without custom TUI work.

The idea evolved into `list` as an interactive management dashboard rather than a passive display. View everything, drill into details, take actions — all in one session.

#### Decision

**Interactive management dashboard. View, update, remove — all inline.**

**Entry point**: `npx agntc list` — no args.

**Initial view**:
1. Spinner: "Checking for updates..." — parallel `git ls-remote` checks for all installed plugins
2. Show all plugins with status indicators:
   - Plugin key + ref
   - Agents installed for
   - Asset counts
   - Update status: up to date, update available (with new ref/SHA), pinned (newer tags exist)

**Interaction flow**:
1. User selects a plugin → detail view (full file list, agents, ref, commit, install date)
2. From detail view, actions offered: **Update** (if available), **Remove**, **Back**
3. After executing an action, loop back to the list with updated state — don't exit
4. User exits explicitly (cancel / ctrl+c / "Done" option)

**Actions execute inline** — `list` has side effects. Update and remove run the same mechanics as their standalone commands. Remove still shows confirmation prompt (consistency — remove always confirms regardless of entry point).

**Update check approach**: parallel `git ls-remote` calls behind a single spinner. @clack/prompts `spinner()` covers this. Responsive for typical install sizes (2-10 plugins). If latency becomes a problem at scale, can add caching later.

Actual output styling deferred to implementation — will use @clack/prompts primitives. The above describes information shape and interaction model.

---

### What does error handling look like — partial failures, network errors, git errors?

#### Context

Errors can occur at multiple points: network/git failures during clone, permission errors during copy, partial failures during multi-plugin installs. Need a consistent strategy.

#### Decision

**Retry transient failures, rollback on hard failure, write what succeeded for multi-plugin installs.**

**Network/git errors (clone failures):**
- Retry up to 3 times on transient failures (network timeout, temporary git errors)
- After retries exhausted: surface the git error clearly, abort. Nothing to clean up — no files copied yet.
- Auth failures (private repo, bad credentials): no retry — surface the error immediately. The tool doesn't handle auth; it defers to the user's git configuration.

**Partial failure during copy (single plugin):**
- Rollback to clean state. Delete everything copied so far for this plugin, write no manifest entry.
- A half-installed plugin is worse than no plugin. Better to fail cleanly and let the user retry.
- The manifest `files` list (tracked in memory during copy) tells us exactly what to delete.

**Multi-plugin install (collection with multiple selections):**
- Each plugin is independent. If plugin 1 succeeds and plugin 2 fails (after retries), plugin 1 keeps its manifest entry. Plugin 2 is rolled back.
- Summary shows per-plugin outcome: installed, failed (with error), skipped (user choice from conflicts).

**Edge case acknowledged**: if a copy fails after overwriting a file owned by another plugin, rollback deletes the new copy but the previous plugin's asset is already gone. Accepted as a narrow edge case — user can `update` the previous plugin to restore its files. Not worth adding save/restore complexity for overwritten files during rollback.

---

### Summary

#### Key Insights
1. The four commands follow a consistent pattern — manifest-driven, @clack/prompts for interaction, same source argument format where applicable (owner/repo, owner/repo/plugin-name).
2. `add` is the most complex flow and establishes patterns the others build on — source parsing, mode detection, agent selection, conflict handling.
3. Agent selection always shows all supported agents. Pre-selection based on detection ∩ compatibility. Never block, never skip the prompt.
4. Conflict handling at asset level (not file level) with manifest ownership transfer keeps prompts manageable and state consistent.
5. `list` evolved from a simple dump to an interactive management dashboard — view, update, remove all in one session.
6. `update` follows npm/brew convention — no-arg updates everything, parameterized for selective. Tag-pinned plugins get informed about newer versions but aren't auto-upgraded.
7. Error strategy: retry transient failures, rollback single-plugin failures to clean state, independent success/failure per plugin in multi-plugin installs.

#### Current State
- Resolved: `add` — full flow from source parsing through manifest write
- Resolved: `remove` — interactive + parameterized, always confirm, no modification detection
- Resolved: `update` — update-all default, nuke-and-reinstall, tag-pinned inform-only
- Resolved: `list` — interactive dashboard with inline actions
- Resolved: conflicts — asset-level detection in `add`, ownership transfer via manifest
- Resolved: error handling — retry, rollback, per-plugin independence

#### Next Steps
- [ ] Discuss remaining research topics (naming, deferred items, plugin init scaffolding)

## Research: exploration, from discovery session 001

---
topic: exploration
date: 2026-02-05
---

## Research: Agent Skills Installer (replacing Claude Manager)

Exploring technical feasibility of a standalone npx-based tool that installs AI skills, agents, scripts, and hooks from git repos into projects. Replaces the current Claude Manager (npm dependency + postinstall approach) with explicit commands and multi-agent support.

### Starting Point

What we know so far:
- Tech stack: TypeScript + @clack/prompts + commander
- Core commands: add, remove, update, list (via npx)
- Asset types: skills, agents, commands, hooks, scripts
- Source: git repos (not npm packages)
- Multi-agent: Claude, Cursor, Codex, Cline
- Vercel skill library is reference material but too narrow (skills only)
- Plugin repos should potentially self-declare what gets installed
- Name TBD (using "agentic" as placeholder)

---

### How Claude Manager Works Today

Convention-based discovery: scans for `skills/`, `commands/`, `agents/`, `hooks/`, `scripts/` directories in plugin packages. No config needed — just organize files in standard dirs.

Flow: `npm install plugin` → postinstall runs `claude-manager add` → finds plugin in node_modules → copies assets to `.claude/` → updates `.claude/.plugins-manifest.json`.

Manifest tracks: plugin name, version, list of copied files. Used for cleanup on remove/update.

Plugin repos declare nothing special — just include asset directories and depend on `@leeovery/claude-manager`.

#### Limitations
- Tied to npm ecosystem (must be an npm package)
- postinstall hooks unreliable (npm 7+ preuninstall bug)
- Claude-only target directory
- No version pinning from git tags
- Can't install from arbitrary git repos

### Existing Plugin Structures

Three plugins exist today:

| Plugin | Skills | Agents | Scripts | Commands | References |
|--------|--------|--------|---------|----------|------------|
| claude-technical-workflows | 17 | 8 | 5+ | — | No (inline) |
| claude-laravel | 20 | — | — | — | Yes (6/skill) |
| claude-nuxt | 15 | — | — | — | Yes (2/skill) |

All use `.claude-plugin/plugin.json` with: name, description, version, author.

Skills are either single SKILL.md files or directories with SKILL.md + references/.

### Vercel Skill Library Analysis

**What it does**: `npx skills add <package>` — installs skills from git repos. Supports GitHub shorthand, full URLs, GitLab, local paths. Creates symlinks or copies.

**Limitations discovered**:
- Skills only — no agents, hooks, or broader tooling
- Weak versioning (no semver, no lock files)
- 56% of eval cases: skill never invoked despite being available
- AGENTS.md (passive context) outperforms skills 100% vs 53%
- Vercel themselves now recommend AGENTS.md over skills for general knowledge
- No conflict resolution, no dependency management
- `allowed-tools` unsupported in many agents

**Key insight**: Vercel's own research shows passive context (AGENTS.md) outperforms on-demand skills. Our tool handles both paradigms — skills for task-specific workflows, but also agents/hooks/scripts that modify behavior more deeply.

### Design Decisions

#### Asset Discovery: Convention-Based

Decision: Use convention — scan for known asset directories (`skills/`, `agents/`, `scripts/`, `hooks/`, `commands/`). No plugin manifest needed.

Rationale: Simpler for plugin authors. Just organize files in standard dirs. The tool knows what to look for and where to put it per agent. Initially considered manifest-driven but the complexity isn't justified — convention covers the real use cases.

#### No Symlinks — Copy Only

Decision: Always copy files to the target directory. No symlink option.

Rationale: Vercel offers symlinks but notes they make updates harder. Copies are simpler — files are committed to git, versioned with the project, and work identically across environments (including Claude Code for web).

#### Multi-Agent as First-Class Concern

Decision: Support multiple AI agents (Claude, Cursor, Codex, Cline, etc.) from the start.

Each agent has different target directories:
- Claude: `.claude/skills/`, `.claude/agents/`, etc.
- Cursor: `.cursor/rules/`, `.cursor/skills/`
- Others: TBD

Open questions:
- Auto-detect which agents are in use? (check for `.claude/`, `.cursor/`, etc.)
- Let user choose at install time?
- Could a plugin provide different assets for different agents?

#### Two Repo Modes: Unit vs Collection

Repos can work in two ways, same convention at both levels:

**Unit mode** — repo root IS the package. Everything installs together as a cohesive unit:
```
repo/
├── skills/
│   ├── technical-planning/
│   └── technical-review/
├── agents/
│   └── task-executor.md
└── scripts/
    └── migrate.sh
```
Example: `claude-technical-workflows` — all skills/agents/scripts are interdependent, install as one.

**Collection mode** — each top-level directory is an independent unit. User interactively selects which to install:
```
repo/
├── laravel-actions/
│   ├── skills/
│   └── agents/
├── laravel-testing/
│   └── skills/
└── nuxt-components/
    └── skills/
```
Each subdirectory follows the same convention — has its own `skills/`, `agents/`, etc. User picks which directories to install.

Benefits:
- Same convention everywhere — a "unit" always looks the same
- Solves skill+agent dependency — co-located in the same unit, installed together
- Unit mode = simple, no choices. Collection mode = interactive selection
- A single repo can serve as a curated library of independent toolsets

Decision: Auto-detect which mode, prompt when ambiguous.

Rules:
1. Root has `skills/` or `agents/` directly → **unit mode** (install everything)
2. Root has subdirs containing `skills/` or `agents/` → **collection mode** (interactive pick)
3. Both patterns detected → **ask user**: "Install everything, or pick individual packages?"

#### Git Sourcing

Decision: Shallow clone, copy, discard. No history needed.

Mechanism: `git clone --depth 1` into a temp directory, detect mode, copy assets, delete clone.

Version resolution:
1. `owner/repo@v2.0` → `git clone --depth 1 --branch v2.0` (tag)
2. `owner/repo@some-branch` → `git clone --depth 1 --branch some-branch` (branch)
3. `owner/repo` → `git clone --depth 1` (default HEAD — no assumption about `main` vs `master`)

Supports GitHub shorthand (`owner/repo`) and full URLs. Tags enable proper release management for plugin authors; default HEAD keeps it simple for casual use.

#### Local Tracking Manifest

Decision: `.agntc/manifest.json` at project root. Committed to git so the whole team sees what's installed.

Tracks:
- Which repos are installed (and at what ref/commit)
- Which files were copied and where
- Which agents they were installed for

Enables: `list` (show installed), `remove` (clean up files), `update` (compare stored ref vs remote latest).

```json
{
  "leeovery/claude-technical-workflows": {
    "ref": "v2.1.6",
    "commit": "abc123f",
    "files": ["skills/technical-planning/", "agents/task-executor.md"],
    "agents": ["claude"]
  }
}
```

- `ref`: the tag/branch specified at install time, or `null` if installed from default HEAD
- `commit`: always the resolved SHA at time of install

Flat structure — no wrapping key. Nest later if needed (YAGNI).

Location rationale: Can't live inside `.claude/` since we're multi-agent. `.agntc/` is tool-specific and agent-neutral.

#### Update Semantics

Decision: Smart comparison via `git ls-remote`, avoid unnecessary cloning.

Behavior:
- **No ref pinned** (`ref: null`) → `git ls-remote` for HEAD. Compare SHA to stored `commit`. If different → re-clone, delete old files, re-copy, update manifest. If same → "already up to date."
- **Branch pinned** (`ref: "dev"`) → `git ls-remote` for branch tip. Same comparison.
- **Tag pinned** (`ref: "v2.0"`) → tag resolves to same commit, so always "already up to date." To upgrade: `npx agentic add owner/repo@v3.0` (explicit re-add with new tag).

#### Conflict Handling

Decision: Always ask. Interactive prompt with two options: **overwrite** or **skip**.

Applies uniformly to:
- **Plugin clash** — two plugins provide the same file. Ask: overwrite or skip.
- **Local edits on update** — user modified an installed file, update brings a new version. Ask: overwrite or skip.

Same UX for both scenarios. Simple, predictable, no surprises.

---

### Multi-Agent Landscape Research

#### Asset type support across agents

| Asset Type | Claude Code | Codex CLI | Cursor | Cline | Windsurf |
|------------|-------------|-----------|--------|-------|----------|
| **Rules/Instructions** | `CLAUDE.md` + `.claude/rules/` | `AGENTS.md` hierarchy | `.cursor/rules/*.mdc` | `.clinerules/*.md` | `.windsurf/rules/*.md` |
| **Skills** | `.claude/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` | — | — | — |
| **Agents/Subagents** | `.claude/agents/*.md` | — | — | — | — |
| **Hooks/Lifecycle** | `.claude/settings.json` + scripts | — | — | — | — |
| **Commands** | `.claude/commands/*.md` (legacy) | — | — | — | — |
| **Plugins** | `.claude-plugin/plugin.json` | — | — | — | — |
| **MCP config** | `.mcp.json` | `config.toml [mcp_servers]` | `.cursor/mcp.json` | — | — |

#### Key observations

**Massive asymmetry in richness.** Claude Code has by far the most asset types: skills, agents, hooks, commands, plugins, rules, memory, MCP, LSP. Codex CLI is second with skills and AGENTS.md layering. Cursor, Cline, and Windsurf are primarily rules-only.

**Skills standard convergence.** Claude Code and Codex CLI both follow the Agent Skills open standard (agentskills.io) — `SKILL.md` entrypoints, `references/`, `scripts/` directories. Shared convention.

**AGENTS.md as lingua franca.** Codex uses it as primary instruction mechanism. Cursor supports it as alternative. Cline reads it as fallback. Closest thing to a cross-tool standard, but inconsistent support.

**Cline reads from other agents.** Cline falls back to `.cursor/rules/` and `.windsurf/rules/` when `.clinerules/` is absent. Cross-tool awareness already exists.

**Windsurf is the most constrained.** 6K per file, 12K total combined rules. Rules only — no skills, agents, hooks.

#### Target directory mapping per agent

| Asset Type | Claude Code | Codex CLI | Cursor | Cline | Windsurf |
|------------|-------------|-----------|--------|-------|----------|
| skills | `.claude/skills/` | `.agents/skills/` | — | — | — |
| agents | `.claude/agents/` | — | — | — | — |
| rules | `.claude/rules/` | — | `.cursor/rules/` | `.clinerules/` | `.windsurf/rules/` |
| hooks | `.claude/hooks/` | — | — | — | — |
| scripts | `.claude/scripts/` | — | — | — | — |
| commands | `.claude/commands/` | — | — | — | — |

#### Implications for the tool

**Not all asset types map across agents.** Skills only make sense for Claude and Codex. Agents and hooks are Claude-only. Rules are the broadest — every agent supports them. This means:

- A plugin repo targeting Claude can use all asset types
- A plugin repo targeting multiple agents may need to think about what maps where
- Rules are the universal currency — if you want cross-agent reach, write rules
- Skills have a shared standard between Claude and Codex but nobody else

**Open questions surfaced:**
- Should the tool attempt to "translate" assets? e.g., convert a skill to a rule for Cursor?
- Or just copy what maps and skip what doesn't? (simpler, more honest)
- Should plugin repos have per-agent directories? e.g., `claude/skills/`, `codex/skills/`, `cursor/rules/`?
- Or just one set of assets that gets routed to the right place per agent?

> **Discussion-ready**: Multi-agent target mapping is well understood. The landscape is deeply asymmetric — Claude Code is richest, Codex shares the skills standard, everyone else is rules-only. Key tradeoffs: translation vs copy-what-maps, per-agent dirs in plugin repos vs single set routed by the tool, and how deep multi-agent support really needs to be for non-Claude agents.

---

### @clack/prompts Research

#### Overview

@clack/prompts is a pre-styled CLI prompt library by bombshell-dev. v1.0.0 released Jan 28, 2026. 7.4k GitHub stars, 2.5M weekly downloads, 3,600+ dependents. 100% TypeScript. Production-ready.

#### Available Primitives

**Input**: `text()`, `password()`, `path()` (file autocomplete), `confirm()`
**Selection**: `select()`, `multiselect()`, `autocomplete()`, `autocompleteMultiselect()`, `groupMultiselect()` (hierarchical)
**Progress**: `spinner()` (indeterminate), `progress()` (bar with 3 styles), `tasks()` (async sequencing), `taskLog()` (streaming output)
**Output**: `intro()`/`outro()`, `note()` (boxed), `box()`, `log.info/warn/error/success/step/message`
**Flow**: `group()` (compose multi-step flows with result passing between steps)

#### Visual Style

Modern, minimal. Box-drawing characters for framing. Symbols: ◆/✕/▲/◇ for states, ◉/◯ for radio, ◻/◼ for checkboxes. Consistent vertical guide line connecting prompts:

```
┌  Plugin Installer
│
◆  Choose repo
│  ● leeovery/claude-laravel
│  ○ leeovery/claude-nuxt
│
◆  Select packages to install
│  ◼ laravel-actions
│  ◼ laravel-testing
│  ◻ laravel-models
│
◇  Installed 2 packages
│
└  Done!
```

#### Key Capabilities for This Tool

- **`group()`** — compose the full install flow (repo selection → mode detection → package pick → agent selection → copy → summary) as a single grouped flow with cancellation handling
- **`multiselect()`** — perfect for collection mode package picking
- **`select()`** — agent selection, conflict resolution (overwrite/skip)
- **`spinner()`** — clone progress, file copying
- **`tasks()`** — sequential operations (clone → detect → copy → manifest)
- **`note()`** — post-install summary of what was installed
- **`isCancel()`** — clean exit handling at any step
- **`groupMultiselect()`** — could group assets by type (skills, agents, etc.)

#### Limitations

- Opinionated styling — limited theme control (use @clack/core for full customization)
- Linear flows — `group()` doesn't branch/conditional well
- No nested menus or tree views
- TTY only — won't work in non-interactive environments (CI/CD would need a `--yes` flag or similar)
- No built-in table rendering

#### @clack/core vs @clack/prompts

`@clack/core` = unstyled headless primitives for full control. `@clack/prompts` = pre-styled wrapper. Use prompts for apps, core for building frameworks. For this tool, `@clack/prompts` is the right choice — we want the opinionated style, not custom rendering.

#### Non-Interactive Mode

Not required. Tool is interactive-only — no CI/CD or non-TTY use case to worry about.

---

### Agent Skills Open Standard (agentskills.io)

#### Adoption

Much broader than expected — 27+ tools have adopted it: Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub, VS Code, Roo Code, Goose, Amp, and many more. Becoming the de facto standard for agent capabilities.

#### Specification Summary

A skill = a directory containing `SKILL.md` (required):

```
skill-name/
├── SKILL.md          # Required entrypoint
├── scripts/          # Optional executables
├── references/       # Optional docs loaded on demand
└── assets/           # Optional static resources
```

Required frontmatter: `name` (must match dir name, lowercase+hyphens, max 64 chars), `description` (max 1024 chars).
Optional: `license`, `compatibility`, `allowed-tools` (experimental), `metadata` (arbitrary key-value).

Progressive disclosure: metadata loaded at startup for all skills, full body on activation, resources on demand. Keep SKILL.md under 500 lines.

#### What the standard covers — and doesn't

The standard **only defines skills**. It says nothing about agents, hooks, commands, or scripts as separate asset types. Those are tool-specific concepts (agents/hooks are Claude Code-specific).

#### Implications explored

- Commands are deprecated in Claude Code — rolled into skills. Support `commands/` dir for backwards compat only.
- `agents/` and `hooks/` being Claude-only is fine for now. Everything is early and standards will converge.
- `scripts/` outside of skills is valid — shared scripts across skills, agent can browse up a directory.
- Plugin-level agent compatibility: a plugin could declare what agents it works with. Inclusive by default (works with all), opt into limiting (e.g., "claude only" because it uses agents/hooks).
- If a plugin limits to certain agents, the tool only offers those agents during install.
- Compatibility could potentially be inferred from directory presence (has `agents/` → needs Claude) or declared explicitly via minimal config.

#### Agent Detection and Plugin Compatibility

**How Vercel does it**: Auto-detect by checking for agent config directories (`.claude/`, `.cursor/`, etc.) in project and home dir. If none found, prompt user to pick. Supports 35+ agents.

**Explored flow for this tool:**

1. Tool clones the repo
2. Reads `agntc.json` (if present) — e.g., `{ "agents": ["claude"] }`
3. Auto-detects what agents the user has installed (check for config dirs)
4. Intersects: plugin's allowed agents ∩ user's installed agents → offer those
5. No `agntc.json` = compatible with all agents

**Compatibility mismatch handling**: If plugin limits to agents the user doesn't have installed, warn but don't block. e.g., "This plugin is only compatible with Claude Code. It doesn't look like you have it installed — install anyway?" User always gets the final say.

**`agntc.json`**: Minimal config file in plugin repo root. Currently just `agents` field. Could grow to hold other metadata as needed. No config = works with everything.

#### Private Repos

Not a concern for the tool. `git clone` defers to the user's local git auth (SSH keys, credential helpers, `gh auth`, PATs, etc.). If they have access, it works. If not, surface the git error clearly. The tool doesn't need to handle auth at all.

---

### Naming Exploration

Current placeholder: "agentic" — taken on npm (squatted, 0.0.2).

#### Concept

The tool injects knowledge into agents — giving them context, skills, expertise they don't have from training. Like teaching, like growing neurons, like expanding what the agent knows for a session.

#### Themes explored

- Knowledge insertion: instill, imbue, impart, endow, infuse
- Brain/neuroscience: synapse, cortex, dendrite, engram, neurons
- Education/growth: primer, syllabus, curriculum, upskill, edify
- Expansion: augment, horizon, frontier
- Greek/Latin roots: noesis (act of knowing), imbuo (to saturate/instill), gnosis (deep knowledge)

#### Available on npm (checked Feb 2026)

**Knowledge-themed**: `noesis`, `noetic`, `imbuo`, `instilo`, `endue`, `akumen`, `studium`, `imbued`
**Neuroscience**: `synapt`, `neurode`, `engrm`
**Practical**: `agntc`, `skillpak`, `upskil`
**Other**: `tutela`, `daimonic`, `entelic`, `praxys`, `uplore`, `knoledge`, `brainpak`, `mindpak`

#### Current frontrunner

`agntc` — developer shorthand for "agentic." Compressed, no vowels, dev-friendly (like `pnpm`, `tmux`, `rg`). Copy-pasteable. `npx agntc add owner/repo` reads clean.

Other strong candidates for further thought: `noesis` (pure knowledge concept), `imbuo` (Latin root of imbue), `skillpak` (practical/clear).

---

### Remove Flow

Manifest-driven: delete files listed in manifest, remove the entry.

- **Units** are all-or-nothing — installed together, removed together
- **Collections** are granular — user picks which plugins to remove
- `npx agntc remove` (no args) → scan manifest, present installed repos/plugins, let user pick
- Manifest needs to track unit vs collection mode and which plugins are installed per collection — structural shape is a discussion-phase decision
- Re-adding to a collection already partially installed → show available plugins, grey out already-installed ones
- Parameterized remove (e.g., `npx agntc remove owner/repo` or `owner/repo/plugin-name`) — unexplored, needs discussion

> **Discussion-ready**: Core mechanics are clear. Manifest needs unit/collection distinction with per-plugin tracking. Interactive UX for removal understood. Exact manifest shape and parameterized remove syntax are discussion decisions.

---

### Update Automation

#### Manual update is already an improvement

`npx agntc update` is better than current `npm update` approach — scoped to plugins only, no risk of updating unrelated project dependencies. Can update all at once or cherry-pick (`npx agntc update owner/repo`).

#### How others do it

- **Claude Marketplace**: Checks at session startup when auto-update enabled. Git-based SHA comparison. Notifies user to restart. Has a known caching bug where cache never refreshes (issue #17361).
- **Vercel Skills**: No auto-update. Manual only (`npx skills check` / `npx skills update`). GitHub tree SHA comparison.

#### Automated checking approaches explored

**SessionStart hook (rejected for now)**: Claude Code has a `SessionStart` hook that can run commands, but (a) can't add latency to startup, and (b) don't want to inject context into Claude's session. Not viable as a synchronous check.

**Two viable approaches identified:**

1. **Check-on-next-command** — any `npx agntc` invocation does a quick background SHA check and surfaces a banner if updates exist. Like Homebrew's "these packages are outdated" on next `brew` command. Zero overhead when you're not using the tool. Surfaces naturally when you're thinking about plugins.

2. **Agent hooks (async, background)** — SessionStart with `"async": true` runs without blocking. Writes a flag file (e.g., `.agntc/.updates-available`) that the next `npx agntc` command picks up and displays. Hook does the check silently in the background; CLI surfaces the result later. Complementary to approach 1.

Non-Claude agents (Cursor, Cline, Codex) have no equivalent lifecycle hooks — so agent hooks approach is Claude-only for now.

> **Discussion-ready**: Manual update is a clear improvement. Two complementary automation approaches identified: check-on-next-command (universal) and async agent hooks (Claude-only, writes flag file for CLI to pick up). Tradeoffs and implementation details are discussion decisions.

---

### CLI UX Walkthrough

Mocked the `add` flow using @clack/prompts visual style. Three scenarios explored:

**Unit install** (`npx agntc add owner/repo@v2.1.8`):
Clone → agent selection → copy → summary with asset counts (17 skills, 8 agents, 5 scripts).

**Collection install** (`npx agntc add owner/repo`):
Clone → detect collection → multiselect plugins → agent selection → copy → summary per plugin.

**Re-add to existing collection**:
Clone → detect already-installed plugins → show them greyed out ("installed") → let user pick additional ones.

Key observations:
- `add` requires a source argument (no interactive "what do you want to install?" prompt) — it'll be copy-pasted from a README anyway
- Single detected agent → auto-select but still show it
- Summary shows asset counts for units, per-plugin paths for collections
- @clack/prompts primitives map cleanly: `multiselect()` for plugin picking, `spinner()` for clone/copy, `note()` for summary

> **Discussion-ready**: UX flow mocked for unit, collection, and re-add scenarios. Core flow shape is clear. Details (exact prompts, edge cases, error states) are discussion/spec decisions.

---

### Deferred to Discussion/Spec

These don't need research — they'll be resolved in later phases:

- GitHub shorthand parsing — implementation detail
- Error handling UX — spec-level
- Existing plugin migration — likely just "re-add via agntc, drop npm deps"
- The `list` command — discussion/spec
- `agntc.json` schema — discussion/spec
- File path collisions across plugins — manifest doesn't track skipped files, could matter on remove
- Plugin author renames/deletes assets between versions — user's agent config may reference old names
- Partial failure during add/update — atomicity/rollback concern

### Discussion-Ready Topics

These threads have converged enough for decision-making in the discussion phase:

- **Multi-agent target mapping** — asymmetric landscape understood, tradeoffs clear
- **Convention vs manifest for asset discovery** — explored both, leaning convention
- **Unit vs collection repo modes** — model is clear, auto-detect approach explored
- **Git sourcing mechanics** — shallow clone, tag/branch/HEAD
- **Update semantics** — smart SHA comparison via git ls-remote
- **Conflict handling** — always ask, overwrite or skip
- **Local manifest structure** — `.agntc/manifest.json`, needs unit/collection distinction
- **Agent detection + plugin compatibility** — Vercel pattern explored, agntc.json config
- **Naming** — agntc frontrunner, npm available
- **Remove flow** — manifest-driven, unit vs collection granularity, interactive picker
- **Update automation** — check-on-next-command + async agent hooks, manual update as baseline
- **CLI UX** — add flow mocked for unit, collection, and re-add scenarios
