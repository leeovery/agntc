---
topic: multi-agent-support
status: in-progress
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
- [ ] What's the right model for plugin ↔ agent compatibility?
- [ ] How does asset routing work — what gets copied where per agent?
- [ ] Should the tool translate assets across agents, or just copy what maps?
- [ ] What does `agntc.json` look like for multi-agent?

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

Starting with three drivers:

| Agent | Project check | System fallback |
|-------|--------------|-----------------|
| Claude | `.claude/` in project | `which claude` or `~/.claude/` |
| Codex | `.agents/` in project | `which codex` |
| Cursor | `.cursor/` in project | `~/.cursor/` |

Adding more agents later = write a new driver, register it. No changes to core logic.

Confidence: High.

---
