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

- [x] What's the full `add` flow — from argument parsing through to manifest write?
- [x] How should `remove` work — interactive, parameterized, or both?
- [x] What are the `update` semantics — per-plugin, per-repo, all-at-once?
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

### Conflict handling during copy

**Decision**: Detect conflicts at the **asset level**, not file level. Prompt as encountered during copy.

- **Skill directory**: `skills/go-development/` exists → one prompt ("This skill already exists. Overwrite or skip?"), not 20 prompts for individual reference files
- **Agent file**: `agents/task-executor.md` exists → one prompt
- **Hook file**: same pattern

Overwrite = nuke the existing asset entirely and replace. No merging, no diffing.

Initially considered scanning all target paths upfront and presenting conflicts as a batch before copying. Rejected — the "as we go" approach is simpler and the asset-level granularity keeps prompt count manageable.

**Manifest ownership transfer**: when overwriting an asset, check if the existing path is tracked in the manifest by another plugin. If so, remove that path from the previous owner's `files` list. If the previous owner's `files` becomes empty, clean up their manifest entry entirely. If the asset wasn't managed by agntc (manually placed), just overwrite — no manifest cleanup needed.

Ownership changes tracked in memory during the operation, manifest written once at the end.

### Manifest write

Single atomic write at the end of the `add` operation:
- Add new plugin entry (or entries for multiple collection plugins)
- Apply any ownership transfers from conflict resolution
- Write `.agntc/manifest.json` once

### Summary

Show what was installed, broken down per agent:

```
Installed leeovery/claude-technical-workflows@v2.1.6

  Claude:
    12 skills, 3 agents, 2 hooks

  Codex:
    12 skills
```

For collections, repeat per plugin. Only shows asset types that were actually installed (no "0 hooks" for Codex).

### Full flow summary

1. Parse source argument (shorthand / URL / local path)
2. Clone repo (shallow) or resolve local path
3. Read `agntc.json` → determine plugin vs collection
4. **If collection**: multiselect plugins (installed ones marked, re-selectable for reinstall)
5. Multiselect agents (pre-select detected ∩ compatible, all agents always available)
6. For each plugin × each agent: route assets via driver config, copy with asset-level conflict prompts
7. Write manifest (new entries + ownership transfers)
8. Show summary (per-agent asset counts)
9. Clean up temp clone dir

---

## How should `remove` work — interactive, parameterized, or both?

### Context

Remove is manifest-driven — read what's installed, delete those files, update the manifest. Research outlined the basics but left invocation modes and edge cases unresolved.

### Decision

**Both interactive and parameterized.**

**Parameterized** (power-user / scriptable):
- `npx agntc remove owner/repo` → remove a standalone plugin, or all plugins from a collection
- `npx agntc remove owner/repo/plugin-name` → remove a specific plugin from a collection

**No-arg interactive** (friendly path):
- `npx agntc remove` → read manifest, present all installed plugins, let user pick which to remove

**Always confirm before deleting.** Show the file paths that will be removed, require explicit yes. Deletion is destructive — the confirmation step is the safety gate.

**No modification detection.** The tool doesn't track file checksums. If the user modified installed files and then removes the plugin, those modifications are gone. Git is the safety net — if they committed their changes, they can recover. Considered detecting modifications but rejected: adds complexity (need to store checksums at install time, compare on remove) for a scenario that git already handles. The confirmation prompt is sufficient.

**Mechanics:**
1. Read manifest, identify target plugin(s) based on argument (or user selection)
2. Show files that will be deleted, ask for confirmation
3. Delete all files listed in the plugin's manifest `files` array
4. Remove the plugin entry from manifest
5. Write manifest
6. Show summary of what was removed

**Collection removal via `owner/repo`**: when the user specifies a repo key that has multiple collection plugins installed, remove all of them. This is the "nuke the whole collection" path. The confirmation step shows everything that will go.

**Empty directories**: leave them. Agent config dirs (`.claude/`, `.agents/`) should persist regardless. Cleaning up empty dirs adds logic for marginal benefit.

---

## What are the `update` semantics — per-plugin, per-repo, all-at-once?

### Context

Update needs to check remote state, compare to stored state, and re-install when newer versions exist. Research proposed smart SHA comparison via `git ls-remote`. Key decisions: invocation granularity, how tag-pinned plugins are handled, and whether agent selection is re-prompted.

### Decision

**No-arg updates everything. Parameterized for selective updates.** Like npm/brew — no interactive picker.

**Invocation:**
- `npx agntc update` → update all installed plugins that can be updated
- `npx agntc update owner/repo` → update specific plugin (or all from a collection)
- `npx agntc update owner/repo/plugin-name` → update specific collection plugin

**Update check per plugin (based on manifest `ref` and `commit`):**
- **`ref: null`** (installed from default HEAD) → `git ls-remote` for HEAD SHA, compare to stored `commit`. Different → update available.
- **`ref: "dev"`** (branch) → `git ls-remote` for branch tip SHA, compare. Different → update available.
- **`ref: "v2.0"`** (tag) → tag resolves to same commit forever. Always "up to date." But: check for newer tags (`git ls-remote --tags`) and inform the user. Don't auto-upgrade — user re-adds with the new tag explicitly.

Initially considered semver range support (`^2.0`, `~2.0`) like npm. Rejected — plugins are independent (no transitive dependencies), so the primary use case for ranges doesn't exist. Semver resolution is complex and we don't need it. Can revisit later if demand materialises.

**Update mechanics (nuke-and-reinstall):**
1. Delete all files listed in the plugin's manifest `files` array
2. Re-clone at the same ref (or HEAD for null ref)
3. Re-copy using the same agents from the manifest entry
4. Update manifest with new commit SHA
5. No re-prompt for agent selection — update means "latest version of what I already have." Changing agents is a re-add.

**No confirmation prompt.** Unlike `remove`, update is non-destructive in intent — user is asking for newer versions of things they already want. The nuke-and-reinstall is an implementation detail, not a user-facing concern.

**Output** shows per-plugin status (actual styling via @clack/prompts):
- Updated plugins: old ref/SHA → new, asset counts per agent
- Already up to date: brief acknowledgment
- Tag-pinned with newer versions: list available tags, show re-add command
