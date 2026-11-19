## Discussion

---
topic: config-file-simplification
status: concluded
work_type: greenfield
date: 2026-02-09
---

## Discussion: Config File Simplification — Rethinking agntc.json

### Context

After completing most discussions, revisiting `agntc.json` with fresh eyes. The file was established across core-architecture (boundary marker: plugin vs collection) and multi-agent-support (metadata carrier: agent compatibility). Two optional fields, both serving different purposes — and that dual purpose felt like a code smell.

The original design also had a convention fallback (no `agntc.json` → scan for asset dirs), making the file sometimes-present, sometimes-not. From a plugin author's perspective: "Do I need this file or not?" shouldn't require reading edge case documentation.

#### References

- [Discussion: core-architecture.md](../core-architecture/log.md#discussion) — original `agntc.json` as boundary marker + type declaration
- [Discussion: multi-agent-support.md](../multi-agent-support/log.md#discussion) — `agents` field added, optional, default-to-all
- [Discussion: plugin-init-scaffolding.md](../plugin-init-scaffolding/log.md#discussion) — init scaffolds `agntc.json`

### Questions

- [x] Should `agntc.json` always be required, or is the convention fallback worth keeping?
- [x] Should we split to three types (skill, plugin, collection) instead of two?
- [x] Should `agents` be required and explicit instead of optional with default-to-all?
- [x] Should collection-level agent config be dropped (no inheritance)?
- [x] Does collection need to be a type at all?
- [x] Can `type` be inferred from structure, eliminating it as a field?
- [x] What ripple effects does this have on other concluded discussions?

---

### Should `agntc.json` always be required?

#### Context

Original design: `agntc.json` optional, convention fallback scans for asset dirs. This created two detection paths and "do I need this file?" ambiguity for plugin authors.

#### Journey

The convention fallback was justified as backwards compatibility for repos that haven't adopted agntc. But agntc is a new tool — there's no installed base. The fallback solves a problem that doesn't exist, and in exchange creates documentation complexity and two code paths.

From the plugin author perspective, "always include `agntc.json`" is one rule. "Include it if you want, but if you don't we'll try to figure it out" is a paragraph of edge cases.

#### Decision

**Always require `agntc.json` for installable units.** No convention fallback.

- Eliminates two-path detection logic
- Documentation becomes: "Step 1: add `agntc.json`"
- Author intent is always explicit
- No "do I need this?" ambiguity

Confidence: High.

---

### Should we split to three types (skill, plugin, collection)?

#### Context

Original design had two types: `plugin` (default) and `collection`. But "plugin" covered two structurally different things — a bare skill (SKILL.md at root) and a multi-asset package (skills/, agents/, hooks/ dirs). The tool papered over this with bare-skill fallback logic.

#### Journey

The bare-skill fallback was implicit behaviour: "if no asset dirs found, check for SKILL.md." The author had to know this without being told. Initially considered making skill a first-class type alongside plugin and collection — three explicit types mapping to three installation behaviours.

This was a useful stepping stone but ultimately superseded. Collection was dropped as a type (see "Does collection need to be a type?" below), and then `type` itself was dropped as a field (see "Can type be inferred from structure?" below). The skill/plugin distinction is real but structural, not declared.

#### Decision

**Skill and plugin are distinct concepts with distinct installation behaviours, but they don't need a `type` field.** The distinction is inferred from directory structure. Collection was dropped as a type entirely. See subsequent questions for the full resolution.

Confidence: High.

---

### Should `agents` be required and explicit?

#### Context

Original design: `agents` field optional, omitting it meant "compatible with all detected agents." This was framed as low-friction for authors.

#### Journey

The default-to-all approach is a time bomb. Today "all" means Claude + Codex. When a third agent is added, every existing plugin without an `agents` field silently becomes "compatible" with the new agent — without the author testing or consenting to that.

Requiring explicit declaration is opt-in consent. The author says "I built and tested this for Claude" — and that declaration stays accurate regardless of what agents are added later.

It also removes an entire class of questions: "what does omitting agents mean?", "does empty array mean none or all?", "how does the default interact with detection?"

#### Decision

**`agents` field required. Always explicit.**

- No default-to-all
- Author declares exactly which agents they've built for
- Declaration remains accurate as the agent ecosystem grows
- Removes ambiguity around missing/empty values

Confidence: High.

---

### Should collection-level agent config be dropped?

#### Context

Original design: collection root `agntc.json` declares `agents` which all children inherit unless they override with their own `agntc.json`. This was framed as reducing repetition — 20 skills all targeting Claude only need the root to say `["claude"]`.

#### Journey

Inheritance sounds elegant but creates "where did this value come from?" debugging. Looking at a child plugin's `agntc.json` and seeing no `agents` field — does that mean "all agents" (the old default), or "inherited from parent" (the new rule)? You have to trace up the tree.

With every installable unit declaring its own agents, you look at one file and know everything. No tracing. No inheritance rules to document or implement.

The repetition concern (20 skills each declaring `"agents": ["claude"]`) is real but trivial — it's one line per file. The clarity benefit far outweighs the duplication cost.

#### Decision

**No recursive/inherited agent config. Every installable unit declares its own agents.**

- One file = complete picture, no tracing
- Removes inheritance logic from the tool
- Removes "override" concept from documentation
- Trivial repetition accepted for major clarity gain

Confidence: High.

---

### Does collection need to be a type at all?

#### Context

With recursive agent config removed, collection-level `agntc.json` would only contain `{"type": "collection"}` — a file whose sole purpose is "I'm not a plugin, look at my children." Does this still need to exist?

#### Journey

The reframe: **`agntc.json` means "I am installable."** A collection is not installable — you install children FROM it. It's just a container, not an entity.

If every installable thing must have `agntc.json`, and a collection is not installable, then the collection doesn't need a config file. Its existence is a structural observation: "root has no `agntc.json`, but subdirs do."

This means `type` drops to two values: `skill` and `plugin`. Collection isn't declared — it's detected.

Detection rules:
1. Root has `agntc.json` → standalone installable, read type
2. Root has no `agntc.json` → scan immediate subdirs for `agntc.json` → those are selectable installables
3. Nothing → not an agntc repo

This doesn't contradict "always require config" — the rule is "every installable thing has `agntc.json`." The collection isn't an installable thing.

#### Decision

**Collection is not a type. It's a structural observation.**

- `type` field: `"skill"` or `"plugin"` only (subsequently dropped — see next question)
- Collection detected by: no root config + subdirs with configs
- Collection has no metadata to declare (no agents, no type that affects installation)
- Removes a type value and its associated documentation

Confidence: High.

---

### Can `type` be inferred from structure, eliminating it as a field?

#### Context

With collection dropped as a type, `type` only had two values: `skill` and `plugin`. But these map directly to structural patterns that are already mutually exclusive — SKILL.md at root vs asset dirs. If the structure already tells you, does the author need to declare it?

#### Journey

Followed the thread from collection inference. If a collection doesn't need to declare itself because the structure says so, the same logic applies to skill vs plugin:

- `SKILL.md` present at directory root → it's a skill. Copy the directory as a skill.
- Asset dirs present (`skills/`, `agents/`, `hooks/`) → it's a plugin. Scan and route.
- These patterns are mutually exclusive — no ambiguity.

This means `type` is redundant with structure. The author would be restating what their directory layout already shows.

Removing `type` reduces `agntc.json` to a single field:

```json
{
  "agents": ["claude"]
}
```

One field. One purpose: "these are the agents I work with." Everything else — whether it's a skill or plugin, whether the repo is a collection — is inferred from structure.

The file's *presence* still does useful work: it marks "I am installable" (critical for collection detection — scan subdirs for `agntc.json`). But the file itself carries only one piece of information that genuinely cannot be inferred: agent compatibility. That's domain knowledge in the author's head.

#### Detection rules (final)

1. Root has `agntc.json` → standalone installable
   - Has `SKILL.md` at root → skill (copy directory as a skill)
   - Has asset dirs (`skills/`, `agents/`, `hooks/`) → plugin (scan and route)
   - Neither → warn (config exists but nothing to install)
2. Root has no `agntc.json` → scan immediate subdirs for `agntc.json` → those are selectable installables (collection)
3. Nothing → not an agntc repo

#### Structural examples

**Bare skill (repo root):**
```
my-skill/
  agntc.json       ← {"agents": ["claude"]}
  SKILL.md
  reference.md
```

**Multi-asset plugin (repo root):**
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

**Collection (no root config, children have configs):**
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

#### Decision

**`type` field eliminated. Skill vs plugin inferred from directory structure.**

`agntc.json` is now:
```json
{
  "agents": ["claude"]
}
```

- One required field: `agents`
- File presence = "I am installable"
- Skill vs plugin = structural (SKILL.md vs asset dirs)
- Collection = structural (no root config, subdirs have configs)
- Agent compatibility = the one irreducible piece of author metadata

Confidence: High.

---

### What ripple effects does this have on other concluded discussions?

#### Context

This discussion changes several decisions made in prior discussions. Cataloguing the impacts so the specification phase can reconcile them.

#### Ripple effects

**Core architecture (core-architecture.md):**
- Convention fallback (case 7: no `agntc.json` → scan for asset dirs) → **removed**. No root config now means collection, not fallback.
- Bare skill detection fallback → **removed**. Replaced by structural inference (SKILL.md present = skill).
- The seven validated permutations need re-validation against new detection rules.
- `agntc.json` as "boundary marker + metadata carrier" → **simplified** to metadata only. Boundary is structural.

**Multi-agent support (multi-agent-support.md):**
- `agntc.json` schema: `type` + `agents` both optional → **`agents` only, required**.
- Default-to-all when `agents` omitted → **removed**. Explicit declaration always.
- "Warn don't block" on mismatch → **still applies**. User selects agent not in plugin's list → warn, don't block.
- Recursive agent inheritance in collections → **removed**.

**CLI commands (cli-commands-ux.md):**
- `add` mode detection: read `agntc.json` type field → **infer from structure** (SKILL.md vs asset dirs).
- `add` collection detection: read root `type: "collection"` → **no root config + subdirs with configs**.
- Agent selection pre-selection: "compatible with all" default influenced pre-selection → **no default**. Pre-select based on detection ∩ plugin's explicit `agents` list.

**Plugin init scaffolding (plugin-init-scaffolding.md):**
- Init still offers three choices (skill, plugin, collection) — these are scaffolding paths, not type values.
- Collection init: no root `agntc.json` created, just example subdir with its config.
- `agents` multiselect is mandatory — result always written to config.
- No `type` field written to `agntc.json` — structure communicates type.

#### Decision

**All ripple effects catalogued. Resolution deferred to specification phase** — each spec will reconcile these changes against its source discussions.

---

### Summary

#### Key Insights

1. The code smell was real — dual purpose (`agntc.json` as boundary marker AND metadata carrier) masked that most of what the file did could be inferred from structure.
2. Stripping away everything inferrable left one irreducible piece: agent compatibility. That's author domain knowledge no structural convention can express.
3. "Always require config" evolved to "every installable thing has config" — the collection exception isn't an exception because collections aren't installable.
4. Explicit agent declaration prevents silent auto-enrollment as new agents are added. Opt-in consent, not opt-in by silence.
5. Removing inheritance/recursive config trades trivial repetition for major clarity — one file = complete picture.

#### Before and After

| Aspect | Before | After |
|--------|--------|-------|
| Fields | `type` (optional) + `agents` (optional) | `agents` (required) |
| Purpose | Boundary marker + metadata | Metadata only |
| Convention fallback | Yes (scan for asset dirs) | No (config required) |
| Type declaration | Explicit (`skill`/`plugin`/`collection`) | Inferred from structure |
| Collection config | Root `agntc.json` with `type: "collection"` | No root config needed |
| Agent defaults | Omit = all agents | No default, always explicit |
| Inheritance | Collection agents inherited by children | None, each unit declares own |

#### Current State
- Resolved: `agntc.json` reduced to single required field (`agents`)
- Resolved: type inferred from structure, collection inferred from absence of root config
- Resolved: no inheritance, no defaults, no convention fallback
- Catalogued: ripple effects across four concluded discussions

#### Next Steps
- [ ] Specification phase to reconcile ripple effects against source discussions

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
