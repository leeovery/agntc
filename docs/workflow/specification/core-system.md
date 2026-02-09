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
