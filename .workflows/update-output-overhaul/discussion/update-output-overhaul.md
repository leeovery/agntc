# Discussion: Update Output Overhaul

## Context

`agntc update` (all-plugins mode) produces opaque live output and speaks in commit
hashes the user can't recognise. This feature bundles three interlocking parts, all
landing on the same surface (`src/commands/update.ts`, `src/clone-reinstall.ts`,
`src/nuke-reinstall-pipeline.ts`, `src/summary.ts`):

1. **Per-unit progress clarity.** Every plugin's clone step renders the same generic
   spinner text — `"Cloning repository..."` → `"Cloned successfully"`
   (`clone-reinstall.ts:336,349`) — with no unit identity. The user sees a stack of
   identical anonymous lines and only learns *what* changed at the very end, when the
   per-plugin summary loop prints outcomes (`update.ts:588-609`). Two root causes: the
   anonymous spinner, and redundant per-member cloning — collection members are
   independent manifest entries pointing at the same repo, so `cloneAndReinstall` is
   called once per member and the same repo is shallow-cloned ~10× for a 10-member
   collection (`update.ts:473-480` loop → `clone-reinstall.ts:305`).

2. **Tag-based summary wording.** `update` reports commit hashes
   (`Updated key: 6500f65 -> f395397`, `summary.ts:220-228,261-277`), which installers
   don't recognise. Where the repo is tagged it should speak in semver tags
   (`Updated key from v1.2.3 to v1.3.0`), falling back to short hashes only for the
   untagged / HEAD-tracked case.

3. **Safe-vs-major bump gating.** Confirm/align npm-style gating: auto-apply safe bumps
   (patch + minor within the constraint's major) and show the tag move; block a major
   bump (or a minor on a `0.x` line), naming current vs newer and directing the user to
   re-add explicitly. Part of the work is auditing what already exists (constraint
   resolution in `update-check.ts`/`version-resolve.ts`, `list` out-of-constraint
   display, `update` summary wording) and closing the gap.

### References

- Seed: `seeds/2026-07-19-update-progress-clarity.md` (progress + clone dedup)
- Seed: `seeds/2026-06-09-show-version-tags-on-update.md` (tags + gating)
- Discovery: `.workflows/update-output-overhaul/discovery/sessions/session-001.md`

## Discussion Map

### States

- **pending** (`○`) — identified but not yet explored
- **exploring** (`◐`) — actively being discussed
- **converging** (`→`) — narrowing toward a decision
- **decided** (`✓`) — decision reached with rationale documented

### Map

  Discussion Map — Update Output Overhaul (5 subtopics, all pending)

  ├─ ○ Per-unit progress output [pending]
  │  ├─ ○ Spinner identity — name the unit, resolve inline [pending]
  │  └─ ○ Inline outcome vs end-of-run summary loop [pending]
  ├─ ○ Per-repo clone dedup [pending]
  │  ├─ ○ Grouping updatable entries by source repo [pending]
  │  ├─ ○ Clone ownership refactor (cloneAndReinstall / processUpdateForAll) [pending]
  │  └─ ○ Failure isolation across shared-clone members [pending]
  ├─ ○ Tag-based summary wording [pending]
  │  ├─ ○ Tags-where-tagged vs hash fallback [pending]
  │  └─ ○ Sourcing old/new tag (entry.ref + resolved tag) [pending]
  ├─ ○ Safe-vs-major bump gating [pending]
  │  ├─ ○ Audit: what constraint semantics already gate today [pending]
  │  ├─ ○ Blocking message: passive out-of-constraint → active re-add directive [pending]
  │  └─ ○ 0.x-line + exact-pin edge cases [pending]
  └─ ○ Scope boundary — existing-behaviour audit vs new build [pending]

---

*Subtopics are documented below as they reach `decided` or accumulate enough
exploration to capture.*

---

## Summary

### Key Insights

*(to be captured as the discussion progresses)*

### Open Threads

*(none yet)*

### Current State

- Nothing decided yet — session opening.

## Triage

(none)
