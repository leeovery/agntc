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
- [ ] How does brownfield auto-detection work, and what does it infer vs ask?
- [ ] What gets scaffolded — which dirs, which starter files, what content?
- [ ] How does collection scaffolding work — per-plugin subdirs, adding plugins later?
- [ ] Should bare skill get a shortcut (e.g., `--bare` flag or auto-detected)?

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
