---
topic: deferred-items-triage
status: in-progress
date: 2026-02-09
---

# Discussion: Deferred Items Triage

## Context

Research flagged several items as "deferred to discussion/spec." Some have since been addressed in other discussions. This discussion triages the remainder: decide what needs a proper decision now, what can wait for spec phase, and what's already resolved.

### References

- [Research: exploration.md](../research/exploration.md) (lines 478-490)
- [Discussion: core-architecture.md](core-architecture.md) — plugin/collection model, manifest, asset discovery
- [Discussion: multi-agent-support.md](multi-agent-support.md) — detection, routing, `agntc.json` schema
- [Discussion: cli-commands-ux.md](cli-commands-ux.md) — add/remove/update/list flows (in-progress)

### Already Resolved Elsewhere

- **`agntc.json` schema** — resolved in multi-agent-support: `type` + `agents`, both optional
- **GitHub shorthand parsing** — resolved in cli-commands-ux: three formats (GitHub shorthand with @ref, full git URL, local path)
- **`list` command** — open question in cli-commands-ux discussion
- **Error handling UX / partial failures** — open question in cli-commands-ux discussion (covers partial failure atomicity too)
- **Conflict handling** — open question in cli-commands-ux discussion

### Remaining Deferred Items

These need triage here:

1. Existing plugin migration
2. File path collisions across plugins
3. Plugin author renames/deletes assets between versions

## Questions

- [x] Existing plugin migration — is it just "re-add, drop npm"?
- [x] File path collisions across plugins — is this a real risk?
- [ ] Asset rename/delete between versions — how does nuke-and-reinstall handle this?

---

## Existing plugin migration — is it just "re-add, drop npm"?

### Context

Users currently using Claude Manager (npm dependency + postinstall) need a path to agntc. Research suggested it's just "re-add via agntc, drop npm deps."

### Decision

**No special migration tooling needed.** agntc's overwrite-on-clash behaviour (decided in cli-commands-ux, not yet documented there) handles it implicitly:

1. User runs `npx agntc add owner/repo` — agntc installs files, overwrites any existing copies, creates manifest entry
2. User runs `npm uninstall claude-manager` and removes any leftover references

Step 2 is the user's responsibility. Cleaning up another tool's artifacts is out of scope for agntc.

Confidence: High.

---

## File path collisions across plugins — is this a real risk?

### Context

Research flagged: two different plugins install assets to the same path. The manifest tracks files per plugin, so if plugin B overwrites plugin A's file, removing plugin B deletes a file plugin A thinks it owns. With nuke-and-reinstall, updating either plugin would overwrite the other's version.

### Journey

Initially considered the standard "advise, don't block" pattern — warn the user, let them proceed. But this breaks down for multi-asset plugins.

The key insight: **plugins are atomic, and their internal assets are interdependent.** A complex plugin shipping skills + agents has internal references (a skill may invoke a specific agent by name). Overwriting one asset from that system — e.g., replacing its `agents/review.md` with a different plugin's `agents/review.md` — doesn't just affect one file. It breaks the entire plugin's internal wiring. The skill still references the old agent's behaviour, but the file now contains something different.

This isn't speculative damage. It's guaranteed breakage. "Install anyway" makes no sense because the outcome is objectively destructive — the existing plugin will malfunction.

Considered whether renaming could help (install as `review-2.md`). Doesn't work — skills reference agents by filename, so renaming breaks the new plugin's references instead. No way to resolve the collision without breaking one side or the other.

### Decision

**Hard block on file path collisions. No "install anyway" option.**

During `add`, before any copying, diff the incoming file list against all existing manifest entries. If any path overlaps with a file owned by another plugin:

1. Show which files conflict and which plugin owns them
2. Offer exactly two options:
   - **Remove the conflicting plugin first, then continue the install** — tool handles both in one flow (remove + add), no separate commands needed
   - **Cancel**

No third option. Overwriting is destructive with no upside.

**Edge case — collision within the same collection**: plugin A and plugin B from the same collection both ship `agents/review.md`. This is a plugin authoring bug, but agntc catches it at the same point. User would need to remove plugin A before adding plugin B. Same mechanism, same two options. Unusual but handled.

**Detection is cheap**: the manifest already tracks exact file paths per plugin. The check is a simple set intersection of incoming paths against existing manifest entries. Runs before any file operations.

Confidence: High.

---
