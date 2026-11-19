## Discussion

---
topic: core-architecture
status: concluded
work_type: greenfield
date: 2026-02-09
---

## Discussion: Core Architecture — Repo Modes, Asset Discovery, and Manifest

### Context

agntc is a standalone npx-based tool that installs AI skills, agents, scripts, and hooks from git repos into projects. Replaces current Claude Manager (npm dependency + postinstall). Three tightly coupled decisions need resolution: how assets are discovered in plugin repos, how unit vs collection modes work, and how the manifest tracks everything.

Research explored convention-based discovery, two repo modes (unit/collection), and a flat `.agntc/manifest.json`. These are interdependent — manifest shape depends on mode semantics, which depends on discovery rules.

#### References

- [Research: exploration.md](../../discovery/session-001.md#research-exploration) (lines 72-181)

### Questions

- [x] What's the installable unit, and how is it detected?
- [x] What's the manifest shape that supports both modes cleanly?
- [x] How should convention-based asset discovery handle edge cases?

---

### What's the installable unit, and how is it detected?

#### Context

Need to distinguish between a repo that IS a plugin (install everything) vs a repo that CONTAINS plugins (user picks). Research proposed convention-based detection (scan for `skills/`, `agents/` dirs) with unit/collection modes. But edge cases emerged around single skills, mixed structures, and interdependent assets.

#### Options Considered

**Option A: Pure convention — scan for asset dirs at specific depths**
- Depth 1 asset dirs → plugin. Depth 2 → collection. Both → ask user.
- Pros: zero config for plugin authors
- Cons: ambiguous edge cases (what if a subdir just happens to have a `skills/` dir?), can't distinguish "install all together" from "pick individually", can't express agent compatibility

**Option B: Marker file (`agntc.json`) at each plugin boundary**
- Every selectable plugin gets its own `agntc.json`
- Pros: explicit, no ambiguity, also carries agent compatibility
- Cons: repetitive for simple collections (every skill dir needs its own file)

**Option C: Root-level `agntc.json` with type declaration + optional per-plugin overrides**
- Root `agntc.json` declares `"type": "plugin"` or `"type": "collection"`
- In collection mode, each subdir is a selectable plugin
- Subdirs can optionally have their own `agntc.json` to override (e.g., agent compatibility)
- Convention fallback for repos with no `agntc.json` at all

#### Journey

Started with pure convention (research position). Looked at how Vercel's skills CLI handles it — they scan for all `SKILL.md` files and let users pick individually. That works for skills-only, but we handle interdependent asset types (skills + agents + scripts that must install together, like claude-technical-workflows with 17 skills, 12 agents, 5 scripts).

This surfaced the real question: **what's the atomic boundary?** A plugin is always atomic — you install it whole or not at all. You never cherry-pick skills from within claude-technical-workflows.

Explored what happens with a "collection of skills" — e.g., language-specific skills (Go, PHP, Python) where you want to pick. With option B, every skill dir needs its own `agntc.json` — repetitive when they all target the same agents.

Option C resolved this: root `agntc.json` declares the type, agent compatibility at root applies to all unless a subdir overrides. One config file covers a simple collection; complex cases still handled.

Also settled the terminology: **plugin** (not "unit") for the atomic installable thing. **Collection** for a repo containing multiple plugins.

Considered bare skills (`SKILL.md` at repo root with no wrapping). Decided not to support this as a special case — if you're publishing through agntc, add an `agntc.json`. Keeps detection uniform.

#### Decision

**Option C — root-level `agntc.json` with type declaration.**

Detection rules:
1. Root `agntc.json` with `"type": "collection"` → collection. Each subdir is a selectable plugin.
2. Root `agntc.json` with `"type": "plugin"` (or no type field — plugin is default) → single plugin. Install everything.
3. No `agntc.json` at root → convention fallback: scan for asset dirs at root.

Plugin internals use convention-based asset discovery (`skills/`, `agents/`, `scripts/`, `hooks/`). `agntc.json` marks boundaries and carries metadata; convention discovers assets within those boundaries.

Agent compatibility declared at root applies to all plugins in a collection unless a specific subdir has its own `agntc.json` override.

Confidence: High. Covers all identified use cases cleanly.

---

### What's the manifest shape that supports both modes cleanly?

#### Context

The manifest (`.agntc/manifest.json` in user's project) tracks what's installed so `remove`, `update`, and `list` can work. Needs to handle both standalone plugin installs and individual plugins from collections. Research proposed a flat structure keyed by repo, but collections complicate that — one repo can produce multiple independent installs.

#### Options Considered

**Option A: Key by repo, nest plugins inside**
- Standalone plugins: flat entry with files list
- Collections: entry with `"type": "collection"` and nested `"plugins"` object
- Pros: grouped by source repo, easy to find all installs from one repo
- Cons: two different shapes depending on type, more complex iteration

**Option B: Key by install path — `repo` for plugins, `repo/plugin` for collection items**
- Every entry is a plugin regardless of source
- Collection plugins keyed as `owner/repo/plugin-name`
- Pros: uniform shape, every entry is a plugin, simple iteration
- Cons: collection relationship is implicit (derived from key prefix)

#### Journey

Initially considered option A for its grouping — seemed natural for `update` (one repo = one check). But realized the collection is just a convenience wrapper for the source repo. What you're actually installing is the plugin. The collection doesn't have independent identity in the user's project.

Option B aligns with this: every manifest entry is a plugin. Whether it came from a standalone repo or a collection doesn't change how it's tracked. For `update`, you derive the repo from the key prefix and deduplicate — trivial. For `remove`, you can offer "remove all from this repo" or individual plugins using the same prefix grouping.

Also discussed what each entry needs:
- **`ref`**: what the user asked for — tag, branch, or `null` (default HEAD). Drives update semantics: pinned tag = don't auto-update, branch/null = check for newer.
- **`commit`**: resolved SHA at install time. For comparison against remote.
- **`installedAt`**: timestamp. Informational.
- **`agents`**: which agents this was installed for.
- **`files`**: exact paths of copied files/dirs. Critical for clean removal and update (nuke-and-reinstall approach — delete everything listed, copy fresh from new version).

Discussed update strategy: nuke-and-reinstall is simpler than diffing. Handles all edge cases (removed files, renamed dirs, moved assets) without complexity. The manifest's file list tells you exactly what to delete before re-copying.

#### Decision

**Option B — key by install path, uniform plugin entries.**

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
      ".claude/agents/task-executor.md",
      ".claude/scripts/migrate.sh"
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

- Every entry is a plugin. Uniform shape.
- Collection membership implicit from key (e.g., `leeovery/agent-skills/go` → repo is `leeovery/agent-skills`).
- `ref` + `commit` together answer "what did you ask for?" and "what did you get?"
- `files` lists destination paths — what was actually copied into the project. Enables clean nuke-and-reinstall on update.
- Update approach: delete all `files`, re-clone, re-copy, update manifest entry.

Confidence: High.

---

### How should convention-based asset discovery handle edge cases?

#### Context

Once a plugin boundary is identified, the tool scans inside it for assets to copy. Need to define: what gets copied, what gets ignored, and how to handle structural variations (bare skills, non-asset files, etc.).

#### Options Considered

**Option A: Strict convention only — asset dirs or nothing**
- Only copy contents of recognized asset dirs (`skills/`, `agents/`, etc.)
- Anything not in an asset dir is ignored
- Pros: simple, predictable
- Cons: bare single-skill plugins need a `skills/` wrapper — feels over-structured

**Option B: Convention + bare skill detection**
- Primary: scan for asset dirs and copy their contents
- Fallback: if no asset dirs found, check for `SKILL.md` at plugin root — treat the plugin dir itself as a skill
- Pros: reduces ceremony for single-skill plugins
- Cons: two discovery paths

#### Journey

Initially proposed strict convention only. But this meant a single-skill plugin in a collection needed:
```
go/
└── skills/
    └── go-development/
        └── SKILL.md
```

This felt unnecessarily nested — the `go/` directory name is redundant with `go-development/`, and the `skills/` dir is boilerplate for a single skill. Questioned whether this was too ceremonial.

Realized that `SKILL.md` is already a well-defined marker from the Agent Skills standard. If a plugin directory contains `SKILL.md` at its root (and no asset dirs), the plugin IS a skill. The tool can detect this and install the whole directory as a skill — e.g., copy `go-development/` to `.claude/skills/go-development/`.

This only applies to skills — `SKILL.md` is a unique, standard marker. Agents, hooks, scripts have no equivalent marker, so they always need convention dirs. But skills are the overwhelmingly common single-asset case.

Also resolved what gets ignored: everything not in a recognized asset dir and not a bare `SKILL.md`. So `README.md`, `CLAUDE.md`, `package.json`, `agntc.json` itself — all ignored during copy. These are plugin authoring artifacts, not installation targets.

Recognized asset directories: `skills/`, `agents/`, `scripts/`, `hooks/`, `rules/`.

#### Decision

**Option B — convention + bare skill detection.**

Asset discovery within a plugin:
1. Scan for recognized asset dirs: `skills/`, `agents/`, `scripts/`, `hooks/`, `rules/`
2. If found → copy contents of each to the appropriate target dir per agent
3. If no asset dirs found → check for `SKILL.md` at plugin root
4. If `SKILL.md` found → bare skill — copy the entire plugin directory as a skill
5. If neither → nothing to install, warn

Everything else in the plugin (README, CLAUDE.md, package.json, agntc.json, etc.) is ignored. Only recognized asset dirs and bare skills get copied.

**The author controls granularity**: plugin vs collection is determined by `agntc.json` `"type"` field. A plugin is always atomic — all its assets install together with no choices offered within. If the author wants individual selection, they structure the repo as a collection.

#### Permutations validated

All seven permutations walked through and confirmed working:

**Case 1 — Standalone plugin**: root `agntc.json` (no collection type) + asset dirs → install everything atomically.

**Case 2 — Collection of complex plugins**: root `agntc.json` with `"type": "collection"`, subdirs with asset dirs → user picks plugins, each installs atomically.

**Case 3 — Collection of bare skills**: root `agntc.json` with `"type": "collection"`, subdirs with `SKILL.md` → user picks, each installs as a single skill.

**Case 4 — Mixed collection**: collection containing both complex plugins (with asset dirs) and bare skills → user picks, each installs per its structure.

**Case 5 — Plugin with multiple skills**: root `agntc.json` (no collection type) + `skills/` dir with multiple skills → install ALL skills, no choice. Author bundled them intentionally.

**Case 6 — Plugin vs collection is author's choice**: same directory structure, different `agntc.json` `"type"` value → different behaviour. `{}` = plugin (install all). `{ "type": "collection" }` = user picks.

**Case 7 — No `agntc.json` (convention fallback)**: scan root for asset dirs → treat as plugin. Backwards compatible with repos that haven't adopted agntc config.

Confidence: High.

---

### Summary

#### Key Insights
1. The plugin is the atomic boundary — always installs whole, never cherry-picked. Author controls granularity via `agntc.json` type.
2. `agntc.json` serves dual purpose: boundary marker (plugin vs collection) and metadata carrier (agent compatibility).
3. Convention-based asset discovery works within plugin boundaries with one enhancement: bare skill detection via `SKILL.md`.
4. The manifest is plugin-centric — every entry is a plugin regardless of whether it came from a standalone repo or a collection.
5. Nuke-and-reinstall is the update strategy — simple, handles all edge cases, enabled by manifest's file tracking.

#### Current State
- Resolved: plugin/collection model with `agntc.json` as boundary marker and type declaration
- Resolved: manifest shape — flat, keyed by install path, uniform plugin entries
- Resolved: asset discovery — convention dirs + bare skill fallback, all permutations validated

#### Next Steps
- [ ] Discuss remaining research topics (multi-agent support, CLI commands/UX, naming, deferred items)

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
