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
- [x] What's the manifest shape that supports both modes cleanly?
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

### Context

The manifest (`.agntc/manifest.json` in user's project) tracks what's installed so `remove`, `update`, and `list` can work. Needs to handle both standalone plugin installs and individual plugins from collections. Research proposed a flat structure keyed by repo, but collections complicate that — one repo can produce multiple independent installs.

### Options Considered

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

### Journey

Initially considered option A for its grouping — seemed natural for `update` (one repo = one check). But realized the collection is just a convenience wrapper for the source repo. What you're actually installing is the plugin. The collection doesn't have independent identity in the user's project.

Option B aligns with this: every manifest entry is a plugin. Whether it came from a standalone repo or a collection doesn't change how it's tracked. For `update`, you derive the repo from the key prefix and deduplicate — trivial. For `remove`, you can offer "remove all from this repo" or individual plugins using the same prefix grouping.

Also discussed what each entry needs:
- **`ref`**: what the user asked for — tag, branch, or `null` (default HEAD). Drives update semantics: pinned tag = don't auto-update, branch/null = check for newer.
- **`commit`**: resolved SHA at install time. For comparison against remote.
- **`installedAt`**: timestamp. Informational.
- **`agents`**: which agents this was installed for.
- **`files`**: exact paths of copied files/dirs. Critical for clean removal and update (nuke-and-reinstall approach — delete everything listed, copy fresh from new version).

Discussed update strategy: nuke-and-reinstall is simpler than diffing. Handles all edge cases (removed files, renamed dirs, moved assets) without complexity. The manifest's file list tells you exactly what to delete before re-copying.

### Decision

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

## How should convention-based asset discovery handle edge cases?

*(To be discussed)*

---

## Summary

### Current State
- Resolved: plugin/collection model with `agntc.json` as boundary marker and type declaration
- Resolved: manifest shape — flat, keyed by install path, uniform plugin entries
- Pending: asset discovery edge cases

### Next Steps
- [ ] Work through asset discovery edge cases within a plugin
