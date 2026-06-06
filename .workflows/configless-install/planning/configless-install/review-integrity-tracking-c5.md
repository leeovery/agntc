---
status: in-progress
created: 2026-06-06
cycle: 5
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

Cycle 5 (final auto cycle) re-reviews the plan after the cycle-5 traceability fix that added a **collection-`add` partial-failure exit** to task 5-3: when any member ends `status: "failed"`, `runCollectionPipeline` writes the successful members' manifest entries, renders `renderCollectionAddSummary`, and then `throw new ExitSignal(1)` — with `status: "skipped"` members (not-agntc / nested-collection, task 3-4) explicitly non-fatal. This is the multi-member-install analogue of task 4-7's `update` partial-success exit.

**The addition is internally consistent and correctly grounded.** Verified against the live source and the adjacent tasks:

- **`ExitSignal` import availability** — `src/commands/add.ts` already imports `ExitSignal` at line 18 (`import { ExitSignal, withExitSignal } from "../exit-signal.js";`) and already throws it nine times in `runAdd`. The new `throw new ExitSignal(1)` sits inside `runCollectionPipeline` in the **same file**, so no new import is required; task 5-3's "Do" correctly lists only the `copy-safety.js` symbols as new imports and does not over-specify an `ExitSignal` import. No defect.
- **Code-anchor accuracy** — the real `runCollectionPipeline` ends exactly as the task describes: `await writeManifest(projectDir, updatedManifest)` (~623), then `p.outro(renderCollectionAddSummary({ … results }))` (~626), then the function returns with **no** non-zero exit. The per-member copy `catch` (~592–600) pushes `{ status: "failed", … }`, and the not-agntc/nested-collection skips (~456–476, owned by task 3-4) push `{ status: "skipped", … }`. The proposed `results.some((r) => r.status === "failed")` placement after the write + summary is structurally exact and matches task 4-7's defer-exit-to-end ordering.
- **No contradiction with task 3-4's non-fatal skips** — task 3-4 pushes not-agntc/nested-collection members as `status: "skipped"` and guarantees siblings continue (no hard exit). The 5-3 addition explicitly states a `skipped` member is **non-fatal** and only a `failed` member triggers `ExitSignal(1)`. The two are complementary, not colliding — the `succeeded / aborted / errored` (here `installed / skipped / failed`) partition is preserved.
- **No contradiction with task 5-3's per-member isolation** — a member-level guard violation is pushed per-member as `failed` (line 157) without aborting siblings; the new `results.some(...)` check runs **after** the member loop, so per-member isolation is intact and the exit is a terminal partial-failure signal, not an early abort.
- **Task 4-7 scope is respected** — task 4-7 covers `runAllUpdates` (`src/commands/update.ts`) only and makes no claim over the `add` pipeline; task 5-3's addition explicitly disclaims overlap ("task 4-7 remains scoped to `runAllUpdates` and does **not** cover the `add` pipeline"). No double-ownership or contradiction.

The behavioural consequence — that the **pre-existing** per-member copy-`catch` failure (previously a silent zero-exit) now also drives a non-zero exit — is intentional and spec-grounded (*Error & Abort Behaviour → Partial outcomes for collections*: "exits non-zero if any unit hard-errored … even when other units succeeded"). The 5-3 addition names this case explicitly ("the pre-existing copy-`catch` failure"). Sound.

The plan remains structurally excellent and implementation-ready across all 25 tasks / 5 phases: canonical task-template compliance, vertical slicing (one TDD cycle each, independently testable), sound Foundation → standalone install → collections → lifecycle → hardening progression, and every cross-task dependency explicit, graph-correct, and acyclic. The prior cycles' recap-residue findings (c2 `{ onWarn }` call-shape, c3 not-agntc exit-0 trio, c4 task 2-1 Solution "clean exit") are all confirmed closed — no exit-0 not-agntc residue remains.

**One residual finding**, of the same recap-surface class each prior cycle closed: the cycle-5 fix landed the new collection-`add` partial-failure exit fully across task 5-3's **authoritative** surfaces (Solution, Do, Outcome, Acceptance Criterion, Test) but left the **plan-level recap surfaces** for 5-3 — the planning.md task-table Edge Cases cell and the Phase 5 acceptance — not reflecting it. This is an omission (the recap does not enumerate the new edge case), not a contradiction (nothing stale states the opposite), so it is Minor.

## Findings

### 1. Task 5-3's new collection-`add` partial-failure exit is absent from the plan-level recap surfaces (task-table Edge Cases cell and Phase 5 acceptance)

**Severity**: Minor
**Plan Reference**: planning.md — Phase 5 `#### Tasks` table, `configless-install-5-3` row (Edge Cases cell, line 150); Phase 5 **Acceptance** block (lines 135–140)
**Category**: Internal consistency / recap-surface completeness (a behaviour added to a task's authoritative surfaces not reflected in the plan-level summary index of that task)
**Change Type**: update-task

**Details**:
The cycle-5 traceability fix added a substantive new behaviour to task 5-3 — collection-`add` exits **non-zero** (`ExitSignal(1)`, after committing siblings and rendering the summary) when any member is `status: "failed"`, with `skipped` members non-fatal — and applied it consistently to every authoritative surface of the task body in phase-5-tasks.md:

- **Solution** (line 158, the "Non-zero exit on collection-`add` partial failure" bullet),
- **Outcome** — implied via the per-member failure semantics,
- **Acceptance Criterion** (line 168: "writes the successful members' manifest entries, renders the per-unit summary, and then exits **non-zero** (`ExitSignal(1)`); a `skipped` member … does **not** trigger the non-zero exit"),
- **Test** (line 178: "a collection add with a failed member exits non-zero after committing siblings").

Two **plan-level recap surfaces** for task 5-3 were not updated to reflect this new behaviour:

1. **planning.md line 150 — the 5-3 task-table Edge Cases cell.** This cell is the plan-level index of task 5-3's edge cases; it enumerates the traversal no-op, the subpath/symlink violations, per-member independent scanning, the configless-plugin scan, and "no manifest write or copy on violation" — but has **no** entry for the new "failed member → non-zero exit after committing siblings; skipped member non-fatal" partial-failure contract. A reader scanning the plan-level table for 5-3's behaviours would not see that the task now carries a collection-`add` partial-failure exit (and that the pre-existing copy-failed path now also triggers it).

2. **planning.md lines 135–140 — the Phase 5 Acceptance block.** The acceptance bullets cover the pre-flight scan, the path-traversal and symlink guards, broken-link handling, and the unchanged copy mechanism — but none captures the multi-member-install partial-failure exit that the phase now delivers through 5-3. Task 4-7's analogous `update` partial-success exit is surfaced in its own phase acceptance (planning.md Phase 4, "exit non-zero on partial abort, all-updates summary lists per-unit outcomes"); the parallel `add`-side contract has no Phase 5 acceptance counterpart.

This is an **omission**, not a contradiction — unlike the c2/c3/c4 findings, no recap surface here states the *opposite* (e.g. "exits cleanly"); the recaps simply do not enumerate the newly-added behaviour. The authoritative task body is complete and correct, so an implementer reading task 5-3 will implement the exit correctly. Hence Minor. The fix brings the plan-level recap surfaces into parity with the task body, matching how each prior cycle closed the one residual recap surface left by its fix and keeping the 5-3 / 4-7 partial-failure-exit symmetry visible at the plan level (4-7's exit is surfaced in its phase acceptance and edge-cases cell; 5-3's should be too).

**Current** (planning.md, Phase 5 `#### Tasks` table, `configless-install-5-3` row — Edge Cases cell):

> | configless-install-5-3 | Wire path-traversal + symlink guards as the add copy pre-flight | whole-repo bare skill (traversal no-op, symlink scan still runs), selector subpath escaping clone errors pre-flight non-zero before any copy, valid subpath but escaping symlink errors, collection members each scanned independently before their copy, configless plugin tree scanned, violation names offending unit/path, no manifest write or copy on violation |

**Proposed** (planning.md, Phase 5 `#### Tasks` table, `configless-install-5-3` row — Edge Cases cell):

> | configless-install-5-3 | Wire path-traversal + symlink guards as the add copy pre-flight | whole-repo bare skill (traversal no-op, symlink scan still runs), selector subpath escaping clone errors pre-flight non-zero before any copy, valid subpath but escaping symlink errors, collection members each scanned independently before their copy, configless plugin tree scanned, violation names offending unit/path, no manifest write or copy on violation, collection-add with a failed member exits non-zero (ExitSignal(1)) after committing siblings + rendering the summary, skipped member (not-agntc/nested-collection) non-fatal |

**Current** (planning.md, Phase 5 **Acceptance** block):

> **Acceptance**:
> - [ ] A pre-flight scan runs before every copy that ingests cloned content (`add` and `update`'s re-copy); on any violation it errors before writing anything, exits non-zero, and names the offending unit/path — no on-disk window for escaping content.
> - [ ] The path-traversal guard rejects a selector `<subpath>` that resolves outside the clone and is a no-op for whole-repo (no-selector) installs like the bare-skill case.
> - [ ] The symlink-escape guard rejects any symlink whose target resolves outside the cloned repository root (absolute paths, `..`-escapes), runs on every install including bare skills, and allows symlinks resolving anywhere inside the clone.
> - [ ] Broken (nonexistent-target) symlinks are evaluated lexically: lexical escape above the clone root → reject; otherwise copied verbatim.
> - [ ] The single recursive `cp` runs only on a verified-clean tree; the copy mechanism itself (recursive copy, keep everything, post-copy `agntc.json` deletion) is otherwise unchanged; full suite green.

**Proposed** (planning.md, Phase 5 **Acceptance** block):

> **Acceptance**:
> - [ ] A pre-flight scan runs before every copy that ingests cloned content (`add` and `update`'s re-copy); on any violation it errors before writing anything, exits non-zero, and names the offending unit/path — no on-disk window for escaping content.
> - [ ] The path-traversal guard rejects a selector `<subpath>` that resolves outside the clone and is a no-op for whole-repo (no-selector) installs like the bare-skill case.
> - [ ] The symlink-escape guard rejects any symlink whose target resolves outside the cloned repository root (absolute paths, `..`-escapes), runs on every install including bare skills, and allows symlinks resolving anywhere inside the clone.
> - [ ] Broken (nonexistent-target) symlinks are evaluated lexically: lexical escape above the clone root → reject; otherwise copied verbatim.
> - [ ] A collection-`add` in which any member hard-errors (e.g. an escaping-symlink violation, or the pre-existing per-member copy failure) commits the successful members, renders the per-unit summary, and then exits **non-zero** (`ExitSignal(1)`); a `skipped` member (not-agntc / nested-collection) is non-fatal — the multi-member-install analogue of the Phase 4 `update` partial-success exit, per spec *Error & Abort Behaviour → Partial outcomes for collections*.
> - [ ] The single recursive `cp` runs only on a verified-clean tree; the copy mechanism itself (recursive copy, keep everything, post-copy `agntc.json` deletion) is otherwise unchanged; full suite green.

**Resolution**: Pending
**Notes**:

---
