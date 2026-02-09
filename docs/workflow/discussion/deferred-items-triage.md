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
- **`list` command** — open question in cli-commands-ux discussion
- **Error handling UX** — open question in cli-commands-ux discussion

### Remaining Deferred Items

These need triage here:

1. GitHub shorthand parsing
2. Existing plugin migration
3. File path collisions across plugins
4. Plugin author renames/deletes assets between versions
5. Partial failure during add/update (atomicity/rollback)

## Questions

- [ ] GitHub shorthand parsing — discuss now or defer to spec?
- [ ] Existing plugin migration — is it just "re-add, drop npm"?
- [ ] File path collisions across plugins — is this a real risk?
- [ ] Asset rename/delete between versions — how does nuke-and-reinstall handle this?
- [ ] Partial failure atomicity — what guarantees do we need?

---
