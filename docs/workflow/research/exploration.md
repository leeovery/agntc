---
topic: exploration
date: 2026-02-05
---

# Research: Agent Skills Installer (replacing Claude Manager)

Exploring technical feasibility of a standalone npx-based tool that installs AI skills, agents, scripts, and hooks from git repos into projects. Replaces the current Claude Manager (npm dependency + postinstall approach) with explicit commands and multi-agent support.

## Starting Point

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

## How Claude Manager Works Today

Convention-based discovery: scans for `skills/`, `commands/`, `agents/`, `hooks/`, `scripts/` directories in plugin packages. No config needed — just organize files in standard dirs.

Flow: `npm install plugin` → postinstall runs `claude-manager add` → finds plugin in node_modules → copies assets to `.claude/` → updates `.claude/.plugins-manifest.json`.

Manifest tracks: plugin name, version, list of copied files. Used for cleanup on remove/update.

Plugin repos declare nothing special — just include asset directories and depend on `@leeovery/claude-manager`.

### Limitations
- Tied to npm ecosystem (must be an npm package)
- postinstall hooks unreliable (npm 7+ preuninstall bug)
- Claude-only target directory
- No version pinning from git tags
- Can't install from arbitrary git repos

## Existing Plugin Structures

Three plugins exist today:

| Plugin | Skills | Agents | Scripts | Commands | References |
|--------|--------|--------|---------|----------|------------|
| claude-technical-workflows | 17 | 8 | 5+ | — | No (inline) |
| claude-laravel | 20 | — | — | — | Yes (6/skill) |
| claude-nuxt | 15 | — | — | — | Yes (2/skill) |

All use `.claude-plugin/plugin.json` with: name, description, version, author.

Skills are either single SKILL.md files or directories with SKILL.md + references/.

## Vercel Skill Library Analysis

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

## Design Decisions

### Asset Discovery: Convention-Based

Decision: Use convention — scan for known asset directories (`skills/`, `agents/`, `scripts/`, `hooks/`, `commands/`). No plugin manifest needed.

Rationale: Simpler for plugin authors. Just organize files in standard dirs. The tool knows what to look for and where to put it per agent. Initially considered manifest-driven but the complexity isn't justified — convention covers the real use cases.

### No Symlinks — Copy Only

Decision: Always copy files to the target directory. No symlink option.

Rationale: Vercel offers symlinks but notes they make updates harder. Copies are simpler — files are committed to git, versioned with the project, and work identically across environments (including Claude Code for web).

### Multi-Agent as First-Class Concern

Decision: Support multiple AI agents (Claude, Cursor, Codex, Cline, etc.) from the start.

Each agent has different target directories:
- Claude: `.claude/skills/`, `.claude/agents/`, etc.
- Cursor: `.cursor/rules/`, `.cursor/skills/`
- Others: TBD

Open questions:
- Auto-detect which agents are in use? (check for `.claude/`, `.cursor/`, etc.)
- Let user choose at install time?
- Could a plugin provide different assets for different agents?

### Two Repo Modes: Unit vs Collection

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

### Git Sourcing

Decision: Shallow clone, copy, discard. No history needed.

Mechanism: `git clone --depth 1` into a temp directory, detect mode, copy assets, delete clone.

Version resolution:
1. `owner/repo@v2.0` → `git clone --depth 1 --branch v2.0` (tag)
2. `owner/repo@some-branch` → `git clone --depth 1 --branch some-branch` (branch)
3. `owner/repo` → `git clone --depth 1` (default HEAD — no assumption about `main` vs `master`)

Supports GitHub shorthand (`owner/repo`) and full URLs. Tags enable proper release management for plugin authors; default HEAD keeps it simple for casual use.

### Local Tracking Manifest

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

### Update Semantics

Decision: Smart comparison via `git ls-remote`, avoid unnecessary cloning.

Behavior:
- **No ref pinned** (`ref: null`) → `git ls-remote` for HEAD. Compare SHA to stored `commit`. If different → re-clone, delete old files, re-copy, update manifest. If same → "already up to date."
- **Branch pinned** (`ref: "dev"`) → `git ls-remote` for branch tip. Same comparison.
- **Tag pinned** (`ref: "v2.0"`) → tag resolves to same commit, so always "already up to date." To upgrade: `npx agentic add owner/repo@v3.0` (explicit re-add with new tag).

### Conflict Handling

Decision: Always ask. Interactive prompt with two options: **overwrite** or **skip**.

Applies uniformly to:
- **Plugin clash** — two plugins provide the same file. Ask: overwrite or skip.
- **Local edits on update** — user modified an installed file, update brings a new version. Ask: overwrite or skip.

Same UX for both scenarios. Simple, predictable, no surprises.

---

## Multi-Agent Landscape Research

### Asset type support across agents

| Asset Type | Claude Code | Codex CLI | Cursor | Cline | Windsurf |
|------------|-------------|-----------|--------|-------|----------|
| **Rules/Instructions** | `CLAUDE.md` + `.claude/rules/` | `AGENTS.md` hierarchy | `.cursor/rules/*.mdc` | `.clinerules/*.md` | `.windsurf/rules/*.md` |
| **Skills** | `.claude/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` | — | — | — |
| **Agents/Subagents** | `.claude/agents/*.md` | — | — | — | — |
| **Hooks/Lifecycle** | `.claude/settings.json` + scripts | — | — | — | — |
| **Commands** | `.claude/commands/*.md` (legacy) | — | — | — | — |
| **Plugins** | `.claude-plugin/plugin.json` | — | — | — | — |
| **MCP config** | `.mcp.json` | `config.toml [mcp_servers]` | `.cursor/mcp.json` | — | — |

### Key observations

**Massive asymmetry in richness.** Claude Code has by far the most asset types: skills, agents, hooks, commands, plugins, rules, memory, MCP, LSP. Codex CLI is second with skills and AGENTS.md layering. Cursor, Cline, and Windsurf are primarily rules-only.

**Skills standard convergence.** Claude Code and Codex CLI both follow the Agent Skills open standard (agentskills.io) — `SKILL.md` entrypoints, `references/`, `scripts/` directories. Shared convention.

**AGENTS.md as lingua franca.** Codex uses it as primary instruction mechanism. Cursor supports it as alternative. Cline reads it as fallback. Closest thing to a cross-tool standard, but inconsistent support.

**Cline reads from other agents.** Cline falls back to `.cursor/rules/` and `.windsurf/rules/` when `.clinerules/` is absent. Cross-tool awareness already exists.

**Windsurf is the most constrained.** 6K per file, 12K total combined rules. Rules only — no skills, agents, hooks.

### Target directory mapping per agent

| Asset Type | Claude Code | Codex CLI | Cursor | Cline | Windsurf |
|------------|-------------|-----------|--------|-------|----------|
| skills | `.claude/skills/` | `.agents/skills/` | — | — | — |
| agents | `.claude/agents/` | — | — | — | — |
| rules | `.claude/rules/` | — | `.cursor/rules/` | `.clinerules/` | `.windsurf/rules/` |
| hooks | `.claude/hooks/` | — | — | — | — |
| scripts | `.claude/scripts/` | — | — | — | — |
| commands | `.claude/commands/` | — | — | — | — |

### Implications for the tool

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

## @clack/prompts Research

### Overview

@clack/prompts is a pre-styled CLI prompt library by bombshell-dev. v1.0.0 released Jan 28, 2026. 7.4k GitHub stars, 2.5M weekly downloads, 3,600+ dependents. 100% TypeScript. Production-ready.

### Available Primitives

**Input**: `text()`, `password()`, `path()` (file autocomplete), `confirm()`
**Selection**: `select()`, `multiselect()`, `autocomplete()`, `autocompleteMultiselect()`, `groupMultiselect()` (hierarchical)
**Progress**: `spinner()` (indeterminate), `progress()` (bar with 3 styles), `tasks()` (async sequencing), `taskLog()` (streaming output)
**Output**: `intro()`/`outro()`, `note()` (boxed), `box()`, `log.info/warn/error/success/step/message`
**Flow**: `group()` (compose multi-step flows with result passing between steps)

### Visual Style

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

### Key Capabilities for This Tool

- **`group()`** — compose the full install flow (repo selection → mode detection → package pick → agent selection → copy → summary) as a single grouped flow with cancellation handling
- **`multiselect()`** — perfect for collection mode package picking
- **`select()`** — agent selection, conflict resolution (overwrite/skip)
- **`spinner()`** — clone progress, file copying
- **`tasks()`** — sequential operations (clone → detect → copy → manifest)
- **`note()`** — post-install summary of what was installed
- **`isCancel()`** — clean exit handling at any step
- **`groupMultiselect()`** — could group assets by type (skills, agents, etc.)

### Limitations

- Opinionated styling — limited theme control (use @clack/core for full customization)
- Linear flows — `group()` doesn't branch/conditional well
- No nested menus or tree views
- TTY only — won't work in non-interactive environments (CI/CD would need a `--yes` flag or similar)
- No built-in table rendering

### @clack/core vs @clack/prompts

`@clack/core` = unstyled headless primitives for full control. `@clack/prompts` = pre-styled wrapper. Use prompts for apps, core for building frameworks. For this tool, `@clack/prompts` is the right choice — we want the opinionated style, not custom rendering.

### Non-Interactive Mode

Not required. Tool is interactive-only — no CI/CD or non-TTY use case to worry about.

---

## Agent Skills Open Standard (agentskills.io)

### Adoption

Much broader than expected — 27+ tools have adopted it: Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub, VS Code, Roo Code, Goose, Amp, and many more. Becoming the de facto standard for agent capabilities.

### Specification Summary

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

### What the standard covers — and doesn't

The standard **only defines skills**. It says nothing about agents, hooks, commands, or scripts as separate asset types. Those are tool-specific concepts (agents/hooks are Claude Code-specific).

### Implications explored

- Commands are deprecated in Claude Code — rolled into skills. Support `commands/` dir for backwards compat only.
- `agents/` and `hooks/` being Claude-only is fine for now. Everything is early and standards will converge.
- `scripts/` outside of skills is valid — shared scripts across skills, agent can browse up a directory.
- Plugin-level agent compatibility: a plugin could declare what agents it works with. Inclusive by default (works with all), opt into limiting (e.g., "claude only" because it uses agents/hooks).
- If a plugin limits to certain agents, the tool only offers those agents during install.
- Compatibility could potentially be inferred from directory presence (has `agents/` → needs Claude) or declared explicitly via minimal config.

### Agent Detection and Plugin Compatibility

**How Vercel does it**: Auto-detect by checking for agent config directories (`.claude/`, `.cursor/`, etc.) in project and home dir. If none found, prompt user to pick. Supports 35+ agents.

**Explored flow for this tool:**

1. Tool clones the repo
2. Reads `agntc.json` (if present) — e.g., `{ "agents": ["claude"] }`
3. Auto-detects what agents the user has installed (check for config dirs)
4. Intersects: plugin's allowed agents ∩ user's installed agents → offer those
5. No `agntc.json` = compatible with all agents

**Compatibility mismatch handling**: If plugin limits to agents the user doesn't have installed, warn but don't block. e.g., "This plugin is only compatible with Claude Code. It doesn't look like you have it installed — install anyway?" User always gets the final say.

**`agntc.json`**: Minimal config file in plugin repo root. Currently just `agents` field. Could grow to hold other metadata as needed. No config = works with everything.

### Private Repos

Not a concern for the tool. `git clone` defers to the user's local git auth (SSH keys, credential helpers, `gh auth`, PATs, etc.). If they have access, it works. If not, surface the git error clearly. The tool doesn't need to handle auth at all.

---

## Naming Exploration

Current placeholder: "agentic" — taken on npm (squatted, 0.0.2).

### Concept

The tool injects knowledge into agents — giving them context, skills, expertise they don't have from training. Like teaching, like growing neurons, like expanding what the agent knows for a session.

### Themes explored

- Knowledge insertion: instill, imbue, impart, endow, infuse
- Brain/neuroscience: synapse, cortex, dendrite, engram, neurons
- Education/growth: primer, syllabus, curriculum, upskill, edify
- Expansion: augment, horizon, frontier
- Greek/Latin roots: noesis (act of knowing), imbuo (to saturate/instill), gnosis (deep knowledge)

### Available on npm (checked Feb 2026)

**Knowledge-themed**: `noesis`, `noetic`, `imbuo`, `instilo`, `endue`, `akumen`, `studium`, `imbued`
**Neuroscience**: `synapt`, `neurode`, `engrm`
**Practical**: `agntc`, `skillpak`, `upskil`
**Other**: `tutela`, `daimonic`, `entelic`, `praxys`, `uplore`, `knoledge`, `brainpak`, `mindpak`

### Current frontrunner

`agntc` — developer shorthand for "agentic." Compressed, no vowels, dev-friendly (like `pnpm`, `tmux`, `rg`). Copy-pasteable. `npx agntc add owner/repo` reads clean.

Other strong candidates for further thought: `noesis` (pure knowledge concept), `imbuo` (Latin root of imbue), `skillpak` (practical/clear).

---

## Remove Flow Research

### What we know

- Manifest tracks which files came from which repo → removal = delete those files + remove manifest entry
- **Units** are all-or-nothing — installed together, removed together
- **Collections** are granular — user picks which plugins to remove

### Manifest needs to evolve

Current manifest is flat (repo → metadata). Collections need per-plugin tracking within the repo entry. The manifest must distinguish unit vs collection mode so the tool knows what removal options to offer. Two structural options explored (nested plugins under repo key vs flat with source backlinks) — shape is a discussion-phase decision.

### Interactive remove (no args)

`npx agntc remove` with no parameter → scan manifest, present installed repos/plugins, let user pick. For collections, offer granular selection (remove one or more plugins). For units, it's binary — remove or don't.

### Re-adding to a collection

`npx agntc add` on a repo already partially installed → show available plugins with already-installed ones greyed out. Let user pick additional plugins without disturbing existing ones.

### Parameterized remove

Some form of direct targeting via CLI args. Exact syntax unexplored — e.g., `npx agntc remove owner/repo` (whole repo) vs `npx agntc remove owner/repo/plugin-name` (specific plugin from collection). Needs discussion.

---

## Update Flow & Automation Research

### Existing update mechanics (from earlier research)

Smart SHA comparison via `git ls-remote` — avoid cloning unless there's actually an update. Tag-pinned installs require explicit re-add with new tag. Branch/HEAD installs compare stored commit SHA against remote tip.

### How Claude Marketplace handles updates

- **Trigger**: Checks at session startup when auto-update is enabled per-marketplace. No periodic background polling.
- **Mechanism**: Git-based. Marketplace repos are pulled, plugin sources re-fetched and re-cached to `~/.claude/plugins/cache/`.
- **Auto-update defaults**: Official Anthropic marketplaces = on by default. Third-party = off by default. User toggles per marketplace.
- **Notification**: After auto-update, notifies user to restart. No hot-reload mid-session.
- **Version tracking**: `~/.claude/plugins/installed_plugins_v2.json` stores commit SHAs. SHA comparison is the real update detection — semver is informational only.
- **Known bug**: Plugin cache is never refreshed even when auto-update pulls new marketplace content (issue #17361, multiple duplicates). Manual cache deletion is the workaround.
- **Private repos**: Background auto-updates can't use interactive auth. Requires env tokens (`GITHUB_TOKEN`, `GITLAB_TOKEN`, etc.).

### How Vercel `npx skills` handles updates

- **No auto-update** — manual only: `npx skills check` and `npx skills update`.
- **Detection**: Posts stored GitHub tree SHAs to a `/check-updates` API, compares against fresh SHAs.
- **Mechanism**: Re-runs `add` command for each outdated skill, updates lock file (`~/.agents/.skill-lock.json`).
- **Scope limitation**: Update tracking only works for globally-installed skills. Project-scoped skills are committed to git and managed via version control.

### Comparison table

| Aspect | Claude Marketplace | Vercel Skills | agntc (TBD) |
|--------|-------------------|---------------|-------------|
| Update check trigger | Session startup (if enabled) | Manual only | ? |
| Auto-update | Yes, per-marketplace toggle | No | ? |
| Detection method | Commit SHA comparison | GitHub tree SHA via API | git ls-remote SHA comparison |
| Update mechanism | Git pull + re-cache | Re-run `add` command | Re-clone + delete old + re-copy |
| Version pinning | ref + sha fields | No explicit pinning | Tag/branch/HEAD |

### Claude Code hooks as update trigger

Claude Code has 14 lifecycle hook events. **`SessionStart`** is the most relevant:

- Fires on new session, resume, clear, or compaction
- Can run arbitrary shell commands
- stdout is injected as context Claude can see
- Can set env vars via `CLAUDE_ENV_FILE`
- Cannot block session start (non-blocking only)
- Configured in `.claude/settings.json` (project or user level)

Example — an update check hook:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "npx agntc check --quiet",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The `SessionStart` stdout goes into Claude's context — so an update check could output "2 plugin updates available" and Claude would see it, potentially informing the user or acting on it.

### Other potential trigger mechanisms

| Mechanism | Pros | Cons |
|-----------|------|------|
| **Claude Code SessionStart hook** | Natural fit — checks when agent is in use. Output visible to Claude. | Claude-only. Adds startup latency. |
| **Git hooks** (post-checkout, post-merge) | Project-level, team-wide. | Not auto-installed. Fires on git ops, not agent sessions. |
| **OS scheduling** (cron/launchd) | Reliable, always runs. | Heavy-handed. System-level setup. |
| **Shell profile** (.bashrc/.zshrc) | Runs on terminal open. | Adds terminal startup latency. Not agent-specific. |

### Open questions for discussion

- Should `npx agntc add` offer to install a SessionStart hook for auto-update checks?
- Check-only (notify) vs auto-update (replace files silently)?
- What about non-Claude agents — no equivalent hook mechanism exists for Cursor, Cline, etc.
- Update + collections: when updating a collection repo, should newly-added plugins (by the author) be surfaced to the user?
- Latency budget — how long can a SessionStart hook take before it's annoying? (10s? 5s? `git ls-remote` is fast but `npx` cold start is not)

> **Discussion-ready**: Remove and update flows are well-understood. Manifest needs to track unit vs collection mode with per-plugin granularity. Claude Code's SessionStart hook is a viable automation mechanism for update checks. Key tradeoffs: check-only vs auto-update, `npx` cold start latency, and non-Claude agents lacking equivalent hooks.

---

## Pending Research Topics

- **Other tools in the space** — anything beyond Vercel skill library we haven't looked at?
- **Full CLI UX walkthrough** — mock up the complete `add` flow with @clack/prompts from start to finish
- **GitHub shorthand parsing** — `owner/repo`, `owner/repo@tag`, full URLs, GitLab support?
- **Error handling UX** — what does the user see when clone fails, no assets found, etc.?
- **Existing plugin migration** — how do current Claude Manager users migrate to this tool?
- **The `list` command** — what info to show, formatting
- **`agntc.json` schema** — what else might go in the plugin config beyond `agents`?

## Discussion-Ready Topics

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
- **Remove flow** — manifest-driven file deletion, unit vs collection granularity, interactive picker
- **Update automation** — SessionStart hook viable for Claude, npx latency concern, non-Claude agents lack equivalent
