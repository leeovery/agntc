---
topic: multi-agent-support
status: concluded
date: 2026-02-09
---

# Discussion: Multi-Agent Support — Detection, Compatibility, and Asset Routing

## Context

agntc installs skills, agents, scripts, hooks, and rules from git repos into projects. The core-architecture discussion resolved plugin/collection model, manifest shape, and asset discovery. Now: how does multi-agent support actually work?

The landscape is deeply asymmetric. Claude Code has the richest asset types (skills, agents, hooks, scripts, rules, MCP). Codex CLI shares the Agent Skills standard. Cursor, Cline, and Windsurf are primarily rules-only. The tool needs a strategy for: detecting which agents a user has, determining what assets can go where, and routing copies to the right target directories.

Key tension: how much effort to invest in non-Claude agents when the capability gap is so large? Translation (converting skills to rules) vs copy-what-maps (only install what the target agent natively supports). Plugin author responsibility vs tool intelligence.

### References

- [Research: exploration.md](../research/exploration.md) (lines 83-256, 362-378)
- [Discussion: core-architecture.md](core-architecture.md) — plugin/collection model, manifest shape, asset discovery

## Questions

- [x] How should agent detection work?
- [x] What's the right model for plugin ↔ agent compatibility?
- [x] How does asset routing work — what gets copied where per agent?
- [x] Should the tool translate assets across agents, or just copy what maps?
- [x] What does `agntc.json` look like for multi-agent?

---

## How should agent detection work?

### Context

The tool needs to know which agents the user has so it can offer the right install targets. Detection is separate from installation — assets always install into the project. This is purely about figuring out what to offer.

### Options Considered

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

### Journey

Started with project-only detection (A). Immediately hit the brand new project problem — if you haven't initialized Claude in a fresh repo yet, project-level detection finds nothing, even though you use Claude extensively. Being punished for being early to a new project is a bad UX.

System-level detection (B) solves this. The key insight: it's not about predicting where to install, it's just asking "does this person use this agent at all?" Project dirs are the cheapest signal, so check those first. If not found, fall back to system checks (`which claude`, `~/.claude/`, etc.). Early returns throughout — if project-level confirms an agent, skip the system check for that one.

Considered tagging results with detection source (project vs system) to influence UX — e.g., pre-selecting project-detected agents. Decided against it: over-engineering for day one, and the tool shouldn't try to predict where the user wants to install.

### Decision

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

## What's the right model for plugin ↔ agent compatibility?

### Context

Plugins contain different asset types (skills, agents, hooks, rules) with varying relevance across agents. Need a model for how plugin authors declare which agents their plugin supports, and what happens when the user's agents don't match.

### Options Considered

**Option A: Plugin-level compatibility (author declares)**
- `agntc.json` has an `agents` field: `["claude"]`, `["claude", "codex"]`, etc.
- Author explicitly states what agents the plugin was built and tested for.
- Pros: author knows best, no guessing, clear intent
- Cons: requires authors to think about it

**Option B: Asset-level compatibility (tool infers)**
- No `agents` field. Tool infers from asset types: has `skills/`? Claude + Codex. Has `rules/`? Everyone.
- Pros: zero config, automatic
- Cons: misleading — a skill tuned for Claude's sub-agents won't work in Codex even though Codex supports skills. The tool can't know that.

### Journey

The core tension: should the tool be smart about compatibility, or should the author be explicit? Asset-level inference (B) seems elegant but breaks down on real examples. Technical-workflows uses Claude sub-agents that Codex doesn't support — the skill format is compatible but the runtime isn't. The tool can't know that from directory structure alone.

The author knows their plugin best. They know if they've tested it with Codex, if it relies on Claude-specific features, if the rules are generic enough for Cursor. This is domain knowledge the tool can't infer.

For the default when no `agents` field is present: considered requiring the field (safer but adds friction) vs defaulting to all agents (optimistic). Default-to-all is self-correcting — the routing layer only copies assets that map to each agent. A skills-only plugin with no `agents` field would only install to Claude and Codex anyway because Cursor has no skills target. The mismatch is handled downstream.

**Mismatch handling**: plugin declares `["claude"]` but user only has Cursor. Principle: "we're not the dad." Warn the user ("This plugin targets Claude, which wasn't detected") but don't block. User might be about to install Claude, installing for a teammate, or just wants to inspect the plugin. Always advise, never gate.

### Decision

**Option A — plugin-level compatibility, author declares via `agents` field.**

- `"agents": ["claude"]` → only offer Claude as install target
- `"agents": ["claude", "codex"]` → offer both
- No `agents` field → compatible with all detected agents (default)
- Mismatch → warn but don't block. User has final say.

The author is in control. The tool respects their declaration. The routing layer (next question) handles what actually gets copied per agent.

Confidence: High.

---

## How does asset routing work — what gets copied where per agent?

### Context

Once the tool knows which agents to install for (from detection + compatibility), it needs to copy assets to the right target directories per agent. Need to define: what asset types exist, where they go for each agent, and how the driver carries this knowledge.

### Journey

**Asset type simplification**: Research listed five asset types: skills, agents, scripts, hooks, rules. Went through each:

- **Scripts**: dropped. Scripts are always part of a skill (referenced from `SKILL.md`, live in the skill's `scripts/` dir). They're not a standalone asset type — they get copied as part of the skill directory. No agent has a concept of standalone installable scripts.

- **Rules**: dropped. Claude has `.claude/rules/` for scoped instruction files, but in practice they're more of a project-level concern (how the user wants their agent to behave) than a plugin-distributable asset. Codex's `AGENTS.md` is equivalent to `CLAUDE.md` — project-managed, not plugin-installed. No current need for rules as a plugin asset type.

- **Skills, agents, hooks**: kept. These are the asset types that plugins actually ship.

**Cursor dropped**: with rules removed, Cursor has zero supported asset types. Skills and agents don't map to Cursor, hooks don't map. No point keeping it as a supported agent with nothing to install. Can add it back later if we support an asset type it can use.

**Driver routing config**: each driver carries a config object mapping asset type → target directory. Only keys present are supported — missing key means that asset type doesn't apply. The routing logic is a simple lookup: check the driver's config for the asset type, if there's a target dir → copy, if not → skip. No routing logic to change when adding agents — it's all in driver config.

### Decision

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

## Should the tool translate assets across agents, or just copy what maps?

### Context

Research raised the question of whether the tool should translate assets — e.g., convert a Claude skill into a Cursor rule, or adapt content for agents that don't support the source asset type.

### Decision

**No translation. Copy what maps, skip what doesn't.**

This question was effectively answered by the routing discussion. With the simplified asset types (skills, agents, hooks) and only two agents (Claude, Codex), there's nothing to translate. Skills follow the same Agent Skills standard for both Claude and Codex — same `SKILL.md` entrypoint, same directory structure. Agents and hooks are Claude-only with no equivalent elsewhere.

The original translation concern was about things like converting skills to rules for Cursor. With Cursor dropped and rules dropped, the entire concern evaporates. If translation becomes relevant when adding new agents or asset types in the future, it can be revisited then.

Confidence: High.

---

## What does `agntc.json` look like for multi-agent?

### Context

`agntc.json` was established in core-architecture as the boundary marker and metadata carrier for plugins. This question resolves the multi-agent additions to its schema.

### Decision

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

## Summary

### Key Insights
1. The driver/strategy pattern unifies detection, compatibility, and routing — each agent is a self-contained driver implementing a shared contract. Adding agents = adding drivers, no core logic changes.
2. Aggressive simplification was the theme: five asset types → three (skills, agents, hooks), five agents → two (Claude, Codex). Removed everything that didn't have a concrete use case today.
3. Plugin authors are in control of compatibility. The tool respects their declarations, warns on mismatches, but never blocks. "We're not the dad."
4. No translation between agents — copy what maps natively, skip what doesn't. The shared Agent Skills standard between Claude and Codex means skills just work in both without conversion.
5. Asset type changes ripple back to core-architecture: recognized asset dirs are now `skills/`, `agents/`, `hooks/` (dropped `scripts/` and `rules/`).

### Current State
- Resolved: agent detection — driver pattern, project-level first with system fallback
- Resolved: plugin compatibility — author declares via `agents` field, default to all, warn-don't-block on mismatch
- Resolved: asset routing — three types, two agents, driver config maps asset type → target dir
- Resolved: no translation — copy what maps
- Resolved: `agntc.json` schema — `type` + `agents`, both optional

### Next Steps
- [ ] Update core-architecture to reflect reduced asset types (skills, agents, hooks — dropped scripts, rules)
- [ ] Discuss remaining research topics (CLI commands/UX, naming, deferred items)
