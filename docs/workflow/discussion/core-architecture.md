---
topic: core-architecture
status: in-progress
date: 2026-02-09
---

# Discussion: Core Architecture — Repo Modes, Asset Discovery, and Manifest

## Context

agntc is a standalone npx-based tool that installs AI skills, agents, scripts, and hooks from git repos into projects. Replaces current Claude Manager (npm dependency + postinstall). Three tightly coupled decisions need resolution: how assets are discovered in plugin repos, how unit vs collection modes work, and how the manifest tracks everything.

Research explored convention-based discovery, two repo modes (unit/collection), and a flat `.agntc/manifest.json`. These are interdependent — manifest shape depends on mode semantics, which depends on discovery rules.

### References

- [Research: exploration.md](../research/exploration.md) (lines 72-181)

## Questions

- [x] What's the installable unit, and how is it detected?
- [ ] What's the manifest shape that supports both modes cleanly?
- [ ] How should convention-based asset discovery handle edge cases?

---

## What's the installable unit, and how is it detected?

### Context

Need to distinguish between a repo that IS a plugin (install everything) vs a repo that CONTAINS plugins (user picks). Research proposed convention-based detection (scan for `skills/`, `agents/` dirs) with unit/collection modes. But edge cases emerged around single skills, mixed structures, and interdependent assets.

### Options Considered

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

### Journey

Started with pure convention (research position). Looked at how Vercel's skills CLI handles it — they scan for all `SKILL.md` files and let users pick individually. That works for skills-only, but we handle interdependent asset types (skills + agents + scripts that must install together, like claude-technical-workflows with 17 skills, 12 agents, 5 scripts).

This surfaced the real question: **what's the atomic boundary?** A plugin is always atomic — you install it whole or not at all. You never cherry-pick skills from within claude-technical-workflows.

Explored what happens with a "collection of skills" — e.g., language-specific skills (Go, PHP, Python) where you want to pick. With option B, every skill dir needs its own `agntc.json` — repetitive when they all target the same agents.

Option C resolved this: root `agntc.json` declares the type, agent compatibility at root applies to all unless a subdir overrides. One config file covers a simple collection; complex cases still handled.

Also settled the terminology: **plugin** (not "unit") for the atomic installable thing. **Collection** for a repo containing multiple plugins.

Considered bare skills (`SKILL.md` at repo root with no wrapping). Decided not to support this as a special case — if you're publishing through agntc, add an `agntc.json`. Keeps detection uniform.

### Decision

**Option C — root-level `agntc.json` with type declaration.**

Detection rules:
1. Root `agntc.json` with `"type": "collection"` → collection. Each subdir is a selectable plugin.
2. Root `agntc.json` with `"type": "plugin"` (or no type field — plugin is default) → single plugin. Install everything.
3. No `agntc.json` at root → convention fallback: scan for asset dirs at root.

Plugin internals use convention-based asset discovery (`skills/`, `agents/`, `scripts/`, `hooks/`). `agntc.json` marks boundaries and carries metadata; convention discovers assets within those boundaries.

Agent compatibility declared at root applies to all plugins in a collection unless a specific subdir has its own `agntc.json` override.

Examples:

```
# Plugin (repo IS the plugin) — e.g., claude-technical-workflows
repo/
├── agntc.json          ← { "agents": ["claude"] }
├── skills/ (17)
├── agents/ (12)
└── scripts/ (5)

# Collection — mixed complexity
repo/
├── agntc.json          ← { "type": "collection" }
├── technical-workflows/
│   ├── agntc.json      ← override: { "agents": ["claude"] }
│   ├── skills/
│   ├── agents/
│   └── scripts/
├── go/
│   └── SKILL.md
├── php/
│   └── SKILL.md
└── python/
    └── SKILL.md

# Simple skill collection
repo/
├── agntc.json          ← { "type": "collection" }
├── go/
│   └── SKILL.md
└── php/
    └── SKILL.md
```

Confidence: High. Covers all identified use cases cleanly.

---

## What's the manifest shape that supports both modes cleanly?

*(To be discussed)*

---

## How should convention-based asset discovery handle edge cases?

*(To be discussed)*

---

## Summary

### Current State
- Resolved: plugin/collection model with `agntc.json` as boundary marker and type declaration
- Pending: manifest shape, asset discovery edge cases

### Next Steps
- [ ] Define manifest structure for tracking plugin and collection installs
- [ ] Work through asset discovery edge cases within a plugin
