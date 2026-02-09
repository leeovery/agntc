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
- **Core architecture**: plugin/collection model, `agntc.json` as boundary marker with `"type"` field, convention-based asset discovery (`skills/`, `agents/`, `scripts/`, `hooks/`, `rules/`), bare skill fallback via `SKILL.md`
- **CLI commands**: `add` flow establishes the consumer side; `init` establishes the author side
- **Multi-agent support**: `agents` field in `agntc.json`, currently Claude and Codex

### References

- [Research: plugin-init-scaffolding.md](../research/plugin-init-scaffolding.md) (lines 1-81)
- [Discussion: core-architecture.md](core-architecture.md) — plugin/collection model, agntc.json, asset discovery
- [Discussion: cli-commands-ux.md](cli-commands-ux.md) — add flow patterns

## Questions

- [ ] What's the exact question flow for `npx agntc init`?
- [ ] How does brownfield auto-detection work, and what does it infer vs ask?
- [ ] What gets scaffolded — which dirs, which starter files, what content?
- [ ] How does collection scaffolding work — per-plugin subdirs, adding plugins later?
- [ ] Should bare skill get a shortcut (e.g., `--bare` flag or auto-detected)?

---
