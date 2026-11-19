## Discussion

---
topic: multi-agent-support
status: concluded
work_type: greenfield
date: 2026-02-09
---

## Discussion: Multi-Agent Support — Detection, Compatibility, and Asset Routing

### Context

agntc installs skills, agents, scripts, hooks, and rules from git repos into projects. The core-architecture discussion resolved plugin/collection model, manifest shape, and asset discovery. Now: how does multi-agent support actually work?

The landscape is deeply asymmetric. Claude Code has the richest asset types (skills, agents, hooks, scripts, rules, MCP). Codex CLI shares the Agent Skills standard. Cursor, Cline, and Windsurf are primarily rules-only. The tool needs a strategy for: detecting which agents a user has, determining what assets can go where, and routing copies to the right target directories.

Key tension: how much effort to invest in non-Claude agents when the capability gap is so large? Translation (converting skills to rules) vs copy-what-maps (only install what the target agent natively supports). Plugin author responsibility vs tool intelligence.

#### References

- [Research: exploration.md](../../discovery/session-001.md#research-exploration) (lines 83-256, 362-378)
- [Discussion: core-architecture.md](../core-architecture/log.md#discussion) — plugin/collection model, manifest shape, asset discovery

### Questions

- [x] How should agent detection work?
- [x] What's the right model for plugin ↔ agent compatibility?
- [x] How does asset routing work — what gets copied where per agent?
- [x] Should the tool translate assets across agents, or just copy what maps?
- [x] What does `agntc.json` look like for multi-agent?

---

### How should agent detection work?

#### Context

The tool needs to know which agents the user has so it can offer the right install targets. Detection is separate from installation — assets always install into the project. This is purely about figuring out what to offer.

#### Options Considered

**Option A: Project-level detection only**
- Scan for agent config dirs (`.claude/`, `.cursor/`, `.agents/`) in the project root.
- Pros: fast, definitive signal
- Cons: fails on brand new projects — no dirs yet, so nothing detected. User with Claude installed globally gets no Claude option.

**Option B: Project-level first, system-level fallback**
- Check project dirs first. For any agent not found at project level, check system-level signals (binary on PATH, home dir config).
- Pros: handles new project case, still fast with early returns
- Cons: slightly more detection logic

**Option C: Always ask, no detection**
- Show all supported agents, let user pick every time.
- Pros: simple, no heuristics
- Cons: annoying for users who only use one agent

#### Journey

Started with project-only detection (A). Immediately hit the brand new project problem — if you haven't initialized Claude in a fresh repo yet, project-level detection finds nothing, even though you use Claude extensively. Being punished for being early to a new project is a bad UX.

System-level detection (B) solves this. The key insight: it's not about predicting where to install, it's just asking "does this person use this agent at all?" Project dirs are the cheapest signal, so check those first. If not found, fall back to system checks (`which claude`, `~/.claude/`, etc.). Early returns throughout — if project-level confirms an agent, skip the system check for that one.

Considered tagging results with detection source (project vs system) to influence UX — e.g., pre-selecting project-detected agents. Decided against it: over-engineering for day one, and the tool shouldn't try to predict where the user wants to install.

#### Decision

**Option B — project-level first, system-level fallback. Driver/strategy pattern for extensibility.**

Architecture:
- Each supported agent is a **driver** implementing a shared contract (TypeScript interface).
- The contract exposes a `detect()` method (among others TBD) returning a typed result: is this agent installed?
- Each driver encapsulates its own detection heuristics — the tool just loops through registered drivers and calls `detect()`.
- Detection uses early returns: cheapest check first (project dir), then system-level if needed.

Starting with two drivers (Cursor dropped — no supported asset types after simplification, see routing question):

| Agent | Project check | System fallback |
|-------|--------------|-----------------|
| Claude | `.claude/` in project | `which claude` or `~/.claude/` |
| Codex | `.agents/` in project | `which codex` |

Adding more agents later = write a new driver, register it. No changes to core logic.

Confidence: High.

---

### What's the right model for plugin ↔ agent compatibility?

#### Context

Plugins contain different asset types (skills, agents, hooks, rules) with varying relevance across agents. Need a model for how plugin authors declare which agents their plugin supports, and what happens when the user's agents don't match.

#### Options Considered

**Option A: Plugin-level compatibility (author declares)**
- `agntc.json` has an `agents` field: `["claude"]`, `["claude", "codex"]`, etc.
- Author explicitly states what agents the plugin was built and tested for.
- Pros: author knows best, no guessing, clear intent
- Cons: requires authors to think about it

**Option B: Asset-level compatibility (tool infers)**
- No `agents` field. Tool infers from asset types: has `skills/`? Claude + Codex. Has `rules/`? Everyone.
- Pros: zero config, automatic
- Cons: misleading — a skill tuned for Claude's sub-agents won't work in Codex even though Codex supports skills. The tool can't know that.

#### Journey

The core tension: should the tool be smart about compatibility, or should the author be explicit? Asset-level inference (B) seems elegant but breaks down on real examples. Technical-workflows uses Claude sub-agents that Codex doesn't support — the skill format is compatible but the runtime isn't. The tool can't know that from directory structure alone.

The author knows their plugin best. They know if they've tested it with Codex, if it relies on Claude-specific features, if the rules are generic enough for Cursor. This is domain knowledge the tool can't infer.

For the default when no `agents` field is present: considered requiring the field (safer but adds friction) vs defaulting to all agents (optimistic). Default-to-all is self-correcting — the routing layer only copies assets that map to each agent. A skills-only plugin with no `agents` field would only install to Claude and Codex anyway because Cursor has no skills target. The mismatch is handled downstream.

**Mismatch handling**: plugin declares `["claude"]` but user only has Cursor. Principle: "we're not the dad." Warn the user ("This plugin targets Claude, which wasn't detected") but don't block. User might be about to install Claude, installing for a teammate, or just wants to inspect the plugin. Always advise, never gate.

#### Decision

**Option A — plugin-level compatibility, author declares via `agents` field.**

- `"agents": ["claude"]` → only offer Claude as install target
- `"agents": ["claude", "codex"]` → offer both
- No `agents` field → compatible with all detected agents (default)
- Mismatch → warn but don't block. User has final say.

The author is in control. The tool respects their declaration. The routing layer (next question) handles what actually gets copied per agent.

Confidence: High.

---

### How does asset routing work — what gets copied where per agent?

#### Context

Once the tool knows which agents to install for (from detection + compatibility), it needs to copy assets to the right target directories per agent. Need to define: what asset types exist, where they go for each agent, and how the driver carries this knowledge.

#### Journey

**Asset type simplification**: Research listed five asset types: skills, agents, scripts, hooks, rules. Went through each:

- **Scripts**: dropped. Scripts are always part of a skill (referenced from `SKILL.md`, live in the skill's `scripts/` dir). They're not a standalone asset type — they get copied as part of the skill directory. No agent has a concept of standalone installable scripts.

- **Rules**: dropped. Claude has `.claude/rules/` for scoped instruction files, but in practice they're more of a project-level concern (how the user wants their agent to behave) than a plugin-distributable asset. Codex's `AGENTS.md` is equivalent to `CLAUDE.md` — project-managed, not plugin-installed. No current need for rules as a plugin asset type.

- **Skills, agents, hooks**: kept. These are the asset types that plugins actually ship.

**Cursor dropped**: with rules removed, Cursor has zero supported asset types. Skills and agents don't map to Cursor, hooks don't map. No point keeping it as a supported agent with nothing to install. Can add it back later if we support an asset type it can use.

**Driver routing config**: each driver carries a config object mapping asset type → target directory. Only keys present are supported — missing key means that asset type doesn't apply. The routing logic is a simple lookup: check the driver's config for the asset type, if there's a target dir → copy, if not → skip. No routing logic to change when adding agents — it's all in driver config.

#### Decision

**Three asset types: skills, agents, hooks. Two agents: Claude, Codex.**

Each driver specifies its target directories as config:

| Asset Type | Claude | Codex |
|-----------|--------|-------|
| skills | `.claude/skills/` | `.agents/skills/` |
| agents | `.claude/agents/` | — |
| hooks | `.claude/hooks/` | — |

Routing is a config lookup per driver — asset type in, target dir out (or null = skip). Adding new agents or updating target dirs is config-only, no routing logic changes.

Note: this also affects core-architecture's asset discovery. Recognized asset dirs within a plugin are now: `skills/`, `agents/`, `hooks/` (was: skills, agents, scripts, hooks, rules).

Confidence: High.

---

### Should the tool translate assets across agents, or just copy what maps?

#### Context

Research raised the question of whether the tool should translate assets — e.g., convert a Claude skill into a Cursor rule, or adapt content for agents that don't support the source asset type.

#### Decision

**No translation. Copy what maps, skip what doesn't.**

This question was effectively answered by the routing discussion. With the simplified asset types (skills, agents, hooks) and only two agents (Claude, Codex), there's nothing to translate. Skills follow the same Agent Skills standard for both Claude and Codex — same `SKILL.md` entrypoint, same directory structure. Agents and hooks are Claude-only with no equivalent elsewhere.

The original translation concern was about things like converting skills to rules for Cursor. With Cursor dropped and rules dropped, the entire concern evaporates. If translation becomes relevant when adding new agents or asset types in the future, it can be revisited then.

Confidence: High.

---

### What does `agntc.json` look like for multi-agent?

#### Context

`agntc.json` was established in core-architecture as the boundary marker and metadata carrier for plugins. This question resolves the multi-agent additions to its schema.

#### Decision

**Minimal schema — `type` + `agents`.**

```json
{
  "type": "plugin",
  "agents": ["claude", "codex"]
}
```

- `type`: `"plugin"` (default if omitted) or `"collection"`. From core-architecture.
- `agents`: array of supported agent identifiers. Optional — omit for "compatible with all agents."

Both fields are optional. An empty `{}` is valid and means: single plugin, all agents. This keeps the barrier to entry low for casual plugin authors while giving power users explicit control.

Can grow later as needed (YAGNI).

Confidence: High.

---

### Summary

#### Key Insights
1. The driver/strategy pattern unifies detection, compatibility, and routing — each agent is a self-contained driver implementing a shared contract. Adding agents = adding drivers, no core logic changes.
2. Aggressive simplification was the theme: five asset types → three (skills, agents, hooks), five agents → two (Claude, Codex). Removed everything that didn't have a concrete use case today.
3. Plugin authors are in control of compatibility. The tool respects their declarations, warns on mismatches, but never blocks. "We're not the dad."
4. No translation between agents — copy what maps natively, skip what doesn't. The shared Agent Skills standard between Claude and Codex means skills just work in both without conversion.
5. Asset type changes ripple back to core-architecture: recognized asset dirs are now `skills/`, `agents/`, `hooks/` (dropped `scripts/` and `rules/`).

#### Current State
- Resolved: agent detection — driver pattern, project-level first with system fallback
- Resolved: plugin compatibility — author declares via `agents` field, default to all, warn-don't-block on mismatch
- Resolved: asset routing — three types, two agents, driver config maps asset type → target dir
- Resolved: no translation — copy what maps
- Resolved: `agntc.json` schema — `type` + `agents`, both optional

#### Next Steps
- [ ] Update core-architecture to reflect reduced asset types (skills, agents, hooks — dropped scripts, rules)
- [ ] Discuss remaining research topics (CLI commands/UX, naming, deferred items)

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
