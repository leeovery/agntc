---
topic: cli-commands-ux
status: in-progress
date: 2026-02-09
---

# Discussion: CLI Commands and UX — Add, Remove, Update, List

## Context

agntc has four core commands: `add`, `remove`, `update`, `list` (plus `init` discussed separately). All are manifest-driven, interactive via @clack/prompts, and share patterns around conflict handling and error states.

Prior discussions resolved the foundation these commands operate on:
- **Core architecture**: plugin/collection model, `agntc.json` as boundary marker, manifest shape (flat, keyed by install path, uniform plugin entries), convention-based asset discovery with bare skill fallback, nuke-and-reinstall update strategy
- **Multi-agent support**: driver/strategy pattern, two agents (Claude, Codex), three asset types (skills, agents, hooks), author-declared compatibility, warn-don't-block

Research mocked the `add` flow for unit/collection/re-add scenarios. `remove` mechanics are outlined (manifest-driven deletion, unit all-or-nothing, collection granular). `update` uses smart SHA comparison via `git ls-remote`. `list` is unexplored.

### References

- [Research: exploration.md](../research/exploration.md) (lines 183-201, 413-474)
- [Discussion: core-architecture.md](core-architecture.md) — plugin/collection model, manifest shape, asset discovery
- [Discussion: multi-agent-support.md](multi-agent-support.md) — detection, routing, compatibility

## Questions

- [ ] What's the full `add` flow — from argument parsing through to manifest write?
- [ ] How should `remove` work — interactive, parameterized, or both?
- [ ] What are the `update` semantics — per-plugin, per-repo, all-at-once?
- [ ] What should `list` show and how?
- [ ] How should conflicts be handled across commands?
- [ ] What does error handling look like — partial failures, network errors, git errors?

---
