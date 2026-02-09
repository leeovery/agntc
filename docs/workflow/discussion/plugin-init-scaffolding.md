---
topic: plugin-init-scaffolding
status: in-progress
date: 2026-02-09
---

# Discussion: Plugin Init Scaffolding

## Context

`npx agntc init` is a plugin author tool that scaffolds new plugin or collection repos. Rather than requiring authors to learn agntc conventions (agntc.json, asset dirs, bare skills, collection structure), the tool asks minimal questions and generates the right structure.

This is **author-facing, not consumer-facing**. It runs in the author's plugin repo, not in a consumer's project. The author has a repo (empty or with existing code) and wants to package it as an agntc-installable plugin.

Prior decisions this builds on:
- **Core architecture**: plugin/collection model, `agntc.json` as boundary marker with `"type"` field, convention-based asset discovery (`skills/`, `agents/`, `hooks/`), bare skill fallback via `SKILL.md`
- **CLI commands**: `add` flow establishes the consumer side; `init` establishes the author side
- **Multi-agent support**: `agents` field in `agntc.json`, currently Claude and Codex

### References

- [Research: plugin-init-scaffolding.md](../research/plugin-init-scaffolding.md) (lines 1-81)
- [Discussion: core-architecture.md](core-architecture.md) — plugin/collection model, agntc.json, asset discovery
- [Discussion: cli-commands-ux.md](cli-commands-ux.md) — add flow patterns

## Questions

- [x] What's the exact question flow for `npx agntc init`?
- [x] How does brownfield auto-detection work, and what does it infer vs ask?
- [ ] What gets scaffolded — which dirs, which starter files, what content?
- [x] How does collection scaffolding work — per-plugin subdirs, adding plugins later?
- [x] Should bare skill get a shortcut (e.g., `--bare` flag or auto-detected)?

---

## What's the exact question flow for `npx agntc init`?

### Context

Need to define the minimal question set that gets authors from empty (or existing) repo to correctly structured agntc plugin. Research proposed: type + agents, scaffold everything. Discussion refined this based on asset types and type-specific needs.

### Options Considered

**Option A: Two questions only (type + agents), scaffold all asset dirs**
- Pros: minimal friction, fewest questions
- Cons: scaffolds `hooks/`, `agents/` dirs for skills-only plugins — noise

**Option B: Type → asset multiselect → agents**
- Pros: only scaffolds what's needed, skills pre-selected makes the common case one-enter
- Cons: one more question

**Option C: Full wizard (type, name, description, assets, agents, starter content)**
- Rejected immediately — over-engineered, YAGNI

### Journey

Started with research position: scaffold all dirs, let authors delete what they don't need. Challenged this — most plugins are skills-only, so `agents/` and `hooks/` dirs would be noise in the majority case.

Considered a multiselect for asset types with `skills` pre-selected. This adds one question but makes the output clean — you only get dirs you'll use. The default path (just hit enter) gives you skills-only, which is the 80% case.

For bare skills, the asset question is irrelevant — no dirs at all. For collections, also irrelevant — the example plugin gets the full structure as a template so the author sees the pattern.

Discussed `name` and `description` fields. Name is unnecessary — dir name is the identity, `agntc.json` doesn't have a name field, manifest keys by `owner/repo` path. Description is YAGNI without a registry. Both skipped.

Also confirmed asset types: `scripts/` and `rules/` have been removed. Current set is `skills/`, `agents/`, `hooks/`.

### Decision

**Flow varies by type:**

| Type | Flow |
|------|------|
| **Bare skill** | Agents multiselect → generate `agntc.json` + `SKILL.md` |
| **Plugin** | Asset multiselect (skills default) → Agents multiselect → generate |
| **Collection** | Agents multiselect → generate root + example `my-plugin/` subdir with full structure |

**Asset multiselect** (plugin only):
- Skills pre-selected, Agents and Hooks unselected
- Default action (enter/proceed) gives you skills-only — zero friction for the common case
- Only shown for standalone plugins; bare skills skip it, collections scaffold full template

**Agent multiselect**: always shown, all supported agents listed. Same pattern as the `add` command — pre-select detected agents.

**No name or description questions.** Dir name is identity. No registry yet.

**Collection example plugin**: scaffolds `my-plugin/` with full structure (`skills/SKILL.md`, `agents/`, `hooks/`, `agntc.json`) as a template. Author renames/edits/duplicates. No interactive loop for adding multiple plugins.

---

## How does brownfield auto-detection work, and what does it infer vs ask?

### Context

Research proposed scanning existing directory structure to infer plugin type (asset dirs at root → plugin, subdirs with assets → collection, etc.) and confirming with the author. Needed to decide how smart detection should be.

### Options Considered

**Option A: Full structural detection — scan dirs, infer type, confirm**
- Scan for asset dirs, `SKILL.md`, subdirs with assets
- Present best guess: "This looks like a {type} — correct?"
- Pros: feels smart, less work for experienced authors
- Cons: detection heuristics are fragile, ambiguous cases (e.g., root asset dirs AND subdirs with assets), false confidence

**Option B: No type detection — always ask, explain the options**
- Skip structural scanning entirely
- Present type options with clear descriptions
- Pros: simple, no edge cases, author knows their intent better than heuristics
- Cons: one question the author has to answer even when obvious

### Journey

Initially proposed full structural detection with confirmation. Pushed back — trying to infer type from directory layout is fragile. Edge cases abound (mixed structures, non-asset dirs that happen to match names). The confirmation step papers over bad guesses but doesn't eliminate them.

Key insight: **the author knows what they're building**. They wrote the plugin. They're technical enough to be authoring AI skills. They don't need hand-holding on "is this a plugin or a collection?" — they just need the terms explained.

### Decision

**Option B — no type detection, always ask.** Present the three options with brief descriptions so the author can self-select:

```
What are you creating?

  ● Skill — a single skill (SKILL.md)
  ○ Plugin — skills, agents, and/or hooks that install together as one package
  ○ Collection — a repo of individually selectable plugins
```

**One exception: `agntc.json` existence check.** If `agntc.json` already exists at root, warn "already initialized" and offer to reconfigure. This isn't type detection — it's a safety guard against double-init.

**Greenfield vs brownfield still matters for scaffolding**, but determined by a simple check: does the directory have existing content? If yes, only write `agntc.json` (don't scaffold dirs or starter files). If no, scaffold the full structure for the chosen type. This is not type detection — it's just deciding whether to create files.

Confidence: High. Simpler, no edge cases, respects the author's knowledge.

---

## How does collection scaffolding work — per-plugin subdirs, adding plugins later?

### Context

For collections, `init` needs to set up the root config. But should it also scaffold individual plugin subdirectories? How deep does the wizard go?

### Options Considered

**Option A: Interactive loop — ask about each plugin in the collection**
- Prompt for name, asset types, etc. for each plugin
- "Add another?" loop
- Pros: comprehensive setup
- Cons: heavy, slow for 10+ plugin collections, over-engineering

**Option B: Scaffold one example plugin + message**
- Create `my-plugin/` with full structure as a template
- "Duplicate and rename for each plugin"
- Pros: shows the pattern, low friction
- Cons: example dir might feel like noise

**Option C: Root config only + documentation**
- Just create root `agntc.json`
- "Add agntc.json to each plugin subdirectory as needed"
- Pros: minimal, respects existing structure
- Cons: author doesn't see the convention structure

### Journey

Initially explored option A (interactive loop). Rejected — turns init into a project management wizard. For a collection with many plugins, answering questions per plugin is tedious.

Option B felt right for greenfield — gives the author something concrete to work from. But for brownfield (existing subdirs with actual plugins), scaffolding `my-plugin/` alongside real work is awkward and confusing.

This led to the split: greenfield vs brownfield determines what gets created beyond root `agntc.json`.

### Decision

**Greenfield collection**: Root `agntc.json` + scaffold `my-plugin/` example with full structure (`skills/my-skill/SKILL.md`, `agents/`, `hooks/`, `agntc.json`). Message: "Created collection root and example plugin. Rename and duplicate for your plugins."

**Brownfield collection**: Root `agntc.json` only. Message: "Created collection config. Add `agntc.json` to each plugin subdirectory as needed."

Good documentation explains the convention structure for authors who need to set up manually.

Confidence: High.

---

## Should bare skill get a shortcut (e.g., `--bare` flag or auto-detected)?

### Decision

**No shortcut needed.** "Skill" is a first-class option in the type selection — it's already one click/enter away. A `--bare` flag or auto-detection would be a second path to the same outcome. YAGNI.

---
