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

## What's the full `add` flow — from argument parsing through to manifest write?

### Context

`add` is the primary command — the most complex flow and the one that establishes patterns the other commands build on. Research mocked three scenarios (unit install, collection install, re-add to collection) but left decision points unresolved.

### Source argument formats

**Decision**: `add` accepts one source per invocation, always required (no no-arg mode). Three formats supported:

- **GitHub shorthand**: `owner/repo`, `owner/repo@v2.0`, `owner/repo@branch-name`
- **Full git URL**: `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git`
- **Local path**: `/absolute/path` or `./relative/path` — for plugin development/testing without pushing to git first

One source per invocation. Multiple plugins from a collection are selected interactively within the flow, not via multiple args.

### Mode detection

After clone (or local path resolution), read root `agntc.json`:
1. `"type": "collection"` → collection mode — present plugin multiselect
2. `"type": "plugin"` or no type field → plugin mode — install everything
3. No `agntc.json` → convention fallback — scan for asset dirs at root, treat as plugin

### Collection plugin selection

For collections, show a multiselect of all plugins in the collection. Already-installed plugins are marked but still selectable — selecting one triggers a reinstall (nuke-and-reinstall, consistent with update strategy). No separate `--force` flag needed.

### Agent selection

**Decision**: Always show the multiselect of all supported agents (currently Claude, Codex). Never skip.

- **Pre-selected**: agents that are both detected (user has them installed) AND compatible (plugin's `agents` field includes them, or plugin has no `agents` field)
- **Not pre-selected but available**: all other supported agents
- **Never block**: user can select any agent regardless of detection or compatibility
- **No auto-select shortcut**: even if only one agent would be pre-selected, still show the multiselect. With multiple supported agents, the user should always see the full picture.

Initially considered auto-selecting when exactly one agent was detected + compatible. Rejected because it hides the option to install for other agents. Simpler rule: always show the multiselect, one code path.
