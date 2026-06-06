---
status: complete
created: 2026-06-06
cycle: 5
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Cycle-5 traceability analysis of the configless-install plan (planning.md + phase-1..5-tasks.md,
25 tasks) against the validated specification, both directions, read fresh. Cycle-4 was clean;
this cycle re-examined the spec's *Error & Abort Behaviour → Partial outcomes for collections*
contract — specifically its explicit reach to "**multi-member installs**," not just `update` —
against the collection-`add` pipeline's exit-status handling, and surfaced **one** genuine
coverage gap.

### Direction 1: Specification → Plan (completeness)

Every spec section has plan coverage with adequate depth, except the one gap below.

- **Overview / anchor cases**, **Config Model**, **Structural Type Detection**, **Identity &
  Naming**, **Manifest Keying & Lifecycle**, **Agent Selection**, **Collection Membership &
  Selection Flow**, **Version Pinning**, **Copy-Safety Hardening**, **Backward-Compat /
  Migration**, and most of **Error & Abort Behaviour** are fully covered (verified in cycles
  1–4, re-confirmed here; no regressions).
- **Error & Abort Behaviour → Partial outcomes for collections** — the per-entry processing,
  loud per-member reporting, and `update`'s non-zero partial-success exit are covered (task 4-7,
  task 3-4). **Gap**: the spec states the non-zero-on-partial-failure exit-status contract for
  "`update` **and multi-member installs**," but no task wires a non-zero exit for the
  collection-**`add`** pipeline when a member hard-errors. Task 5-3 introduces a new member
  `status: "failed"` outcome (escaping-symlink violation) and defers the exit to "Phase 4 task
  4-7 territory" — but task 4-7 is scoped strictly to `update`'s `runAllUpdates`, not
  `runCollectionPipeline`. See Finding 1.

### Direction 2: Plan → Specification (fidelity)

All plan content traces back to the spec; no hallucinated content found. Higher-risk items
(`--plugin > config type` precedence framing, EACCES/IO propagation, retained-`type`-only
config, not-agntc loud non-zero exit, legacy-backfill defaults, update-only symlink pre-flight,
verification-only 3-5/3-6) were re-spot-checked and remain spec-faithful.

## Findings

### 1. Collection-`add` partial failure does not exit non-zero (multi-member install exit-status contract)

**Type**: Incomplete coverage
**Spec Reference**: *Error & Abort Behaviour → Partial outcomes for collections* — "`update`
and multi-member installs operate **per manifest entry** … **Command exit status**: the command
exits **non-zero if any unit hard-errored or aborted**, even when other units succeeded (partial
success). The summary reports per-unit outcomes (succeeded / aborted / errored)."
**Plan Reference**: Phase 5, task configless-install-5-3 (collection member pre-flight scan →
`status: "failed"`); the gap is the absence of a non-zero exit in `runCollectionPipeline`
(`src/commands/add.ts`, which ends after `renderCollectionAddSummary` with no exit code).
**Change Type**: add-to-task

**Details**:
The spec's partial-outcome exit-status contract explicitly covers "`update` **and multi-member
installs**." Task 4-7 wires the non-zero partial-success exit for `update`'s `runAllUpdates`
only. The collection-`add` path (`runCollectionPipeline`) has no equivalent: today it ends after
`renderCollectionAddSummary` with no non-zero exit even when `results` contains a
`status: "failed"` member. Task 5-3 introduces a *new* member-level hard failure — an
escaping-symlink violation surfaced as `results.push({ pluginName, status: "failed", … })` — and
its own prose says "the command exits non-zero overall (the partial-success exit is Phase 4 task
4-7 territory)." But 4-7 never touches the `add` pipeline, so a collection `add` where one member
hard-errors on the symlink guard would print the summary and exit **zero** — contradicting the
spec's "non-zero if any unit hard-errored." An implementer following 5-3 as written would wire the
`failed` outcome and the per-member isolation, then find the promised non-zero exit nonexistent in
the referenced task.

Because the spec treats a member *skip* (not-agntc / nested-collection re-detect, task 3-4)
as benign and a member *hard-error* (the symlink-escape failure 5-3 introduces, plus the
pre-existing copy-`catch` `failed`) as exit-triggering, the fix is scoped to a non-zero exit
when any member result is `failed` — leaving `skipped` members non-fatal, consistent with the
spec's "succeeded / aborted / errored" partition and with task 3-4's loud-but-non-fatal skips.

The fix belongs in task 5-3 because that task introduces the member hard-failure outcome the
contract is about, already edits the per-member failure path, and is the last task touching
`runCollectionPipeline`. The correction also removes 5-3's incorrect forward-reference to 4-7.

**Current** (task configless-install-5-3, the relevant `Do` step):

> - **Collection member violation handling**: a member-level guard violation should be reported per-member loudly (consistent with Phase 3/4 per-member granularity) — treat it like the existing per-member failure path (`results.push({ pluginName, status: "failed", ..., errorMessage })`) so siblings still proceed and the command exits non-zero overall (the partial-success exit is Phase 4 task 4-7 territory; here, ensure the member is reported failed and not copied). Do **not** let one member's escaping symlink abort the whole collection install; do **not** copy or write a manifest entry for the violating member.

**Proposed** (replace that `Do` step with the two steps below):

> - **Collection member violation handling**: a member-level guard violation should be reported per-member loudly (consistent with Phase 3/4 per-member granularity) — treat it like the existing per-member failure path (`results.push({ pluginName, status: "failed", ..., errorMessage })`) so siblings still proceed. Do **not** let one member's escaping symlink abort the whole collection install; do **not** copy or write a manifest entry for the violating member.
> - **Non-zero exit on collection-`add` partial failure**: `runCollectionPipeline` currently ends after `renderCollectionAddSummary` (`src/commands/add.ts` ~626–633) with **no** non-zero exit, even when `results` contains a `status: "failed"` member. Per spec *Error & Abort Behaviour → Partial outcomes for collections*, the exit-status contract covers "`update` **and multi-member installs**": the command must exit **non-zero if any unit hard-errored**, even when siblings succeeded. After the manifest write and the `renderCollectionAddSummary` outro, add: `if (results.some((r) => r.status === "failed")) { throw new ExitSignal(1); }`. Place the throw **after** the manifest write (~623) and the summary render (~626) so successful members are committed and the user sees the full per-unit report before the non-zero exit (mirroring task 4-7's defer-exit-to-end ordering for `update`). A member `status: "skipped"` (not-agntc / nested-collection re-detect, task 3-4) is **non-fatal** — only a `failed` member (escaping-symlink violation here, or the pre-existing copy-`catch` failure) triggers the non-zero exit, matching the spec's "succeeded / aborted / errored" partition. This is the collection-`add` analogue of task 4-7's `update` partial-success exit; task 4-7 remains scoped to `runAllUpdates` and does **not** cover the `add` pipeline.

Add the following **Acceptance Criterion** to task configless-install-5-3:

> - [ ] When a collection-`add` member hard-errors (e.g. its symlink scan throws → `status: "failed"`) while siblings succeed, `runCollectionPipeline` writes the successful members' manifest entries, renders the per-unit summary, and then exits **non-zero** (`ExitSignal(1)`); a `skipped` member (not-agntc / nested-collection) does **not** trigger the non-zero exit.

Add the following **Test** to task configless-install-5-3:

> - `"a collection add with a failed member exits non-zero after committing siblings"` — member-a scan throws (`status: "failed"`), member-b clean (`status: "installed"`); assert `writeManifest` is called with member-b's entry (and **not** member-a's), the summary is rendered, and `ExitSignal(1)` is thrown **after** the write/summary; assert a run where the only non-success outcome is a `skipped` member does **not** throw `ExitSignal(1)`.

**Resolution**: Fixed
**Notes**: Verified against spec lines 460–466 (Error & Abort Behaviour → Partial outcomes for collections — explicitly "`update` **and multi-member installs**", "non-zero if any unit hard-errored or aborted"). Applied to phase-5-tasks.md task 5-3: split the collection-member-violation Do step into two (per-member failure reporting + a new non-zero-exit-on-partial-failure step throwing `ExitSignal(1)` after the manifest write and summary when any member is `status: "failed"`), removed the incorrect forward-reference to 4-7, and added the matching acceptance criterion and test. Synced the mirroring tick task tick-a7815f. `skipped` members (task 3-4) remain non-fatal.
