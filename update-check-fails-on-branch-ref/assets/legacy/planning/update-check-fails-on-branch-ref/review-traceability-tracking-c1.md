---
status: complete
created: 2026-07-02
cycle: 1
phase: Traceability Review
topic: Update Check Fails On Branch Ref
---

# Review Tracking: Update Check Fails On Branch Ref - Traceability

## Summary

Traceability analysis in both directions found **no findings**. The plan is a
faithful, complete translation of the specification.

- **Direction 1 (Spec → Plan, completeness):** Every specification element —
  the dispatch change, the classification probe and its new parse step, the
  tiebreak, the branch/tag comparison-path constraints, error handling and
  dead-code removal, all seven acceptance criteria, the cross-surface recovery
  criteria, the untouched-path guarantees, and every testing requirement
  (new regression cases 1–6, existing tests to rewrite, mock-harness note, and
  the real-`ls-remote`-output preference) — maps onto a task with matching,
  implementer-ready detail.
- **Direction 2 (Plan → Spec, fidelity):** Every task's Problem, Solution, Do
  steps, acceptance criteria, tests, and edge cases trace back to a specific
  specification section. No invented requirements, behaviours, or edge cases.
  The design-target network-cost note is correctly reflected without adding a
  call-count acceptance criterion (the spec explicitly forbids one).

## Coverage Map

| Spec element | Plan location |
|--------------|---------------|
| Dispatch change — steps 1–3 unchanged, 4–5 replaced, `isTagRef` removed (spec §Dispatch change, AC line 44) | Task 1.2 (Problem, Solution, Do, AC) |
| Classification probe — single `ls-remote refs/heads/{ref} refs/tags/{ref}`, `{ timeout: 15_000 }` (spec §Classification probe) | Task 1.2 (Do, AC, Context) |
| New exact-path parse step (spec §Classification probe "new parse step", §In scope) | Task 1.1 (whole task) |
| Exact-path matching, ignore peeled `^{}`, slash-safe, order-independent (spec line 56) | Task 1.1 (Do, AC, Tests, Edge Cases) |
| Routing: only-heads → branch, only-tags → tag, both → tiebreak, neither → check-failed (spec lines 60–63) | Task 1.2 (Do, AC) |
| Tiebreak → tag, gitrevisions precedence (spec §Tiebreak) | Task 1.2 (Do, tiebreak note, Context) |
| Branch reuses probed sha / tag issues own `--tags` (spec §Comparison paths) | Task 1.2 (Do, AC, Context) |
| Error handling — network → check-failed; neither terminal; dead-code guards (spec §Error handling) | Task 1.2 (Do, AC) |
| Preserve `UpdateCheckResult`, no new deps (spec §Constraints) | Task 1.2 (Do, AC) |
| Network cost — design target, no call-count AC (spec line 102) | Task 1.2 (no call-count AC; branch-sha-reuse enforced) |
| Acceptance Criteria 1–7 (spec lines 110–116) | Task 1.2 AC bullets |
| Cross-surface AC (spec lines 118–121) | Task 1.3 (whole task) |
| Untouched paths stay correct (spec line 123) | Task 1.2 AC + Task 1.3 |
| Testing — new regression 1–6 (spec lines 133–138) | Task 1.2 Tests |
| Testing — existing tests to update (spec lines 140–145) | Task 1.2 Tests |
| Mock-harness note (spec lines 147–149) | Task 1.2 Context + Tests |
| Real-`ls-remote`-output preference (spec lines 151–153) | Task 1.1 Tests note, Task 1.2 Context |
| Out of Scope — manifest/`refType`, `add` side, `isTagRef`→`isVersionTag`, list `isVersionTag` gating (spec lines 157–162) | Task 1.2 + Task 1.3 (explicit negative constraints) |
| Severity by surface (spec Overview lines 12–14) | Task 1.3 Problem, Context |

## Codebase-grounding verification

The tasks make several concrete grounding claims; all were verified against the
source and are accurate (they anchor the plan to real symbols, not invention):

- `src/update-check.ts` dispatch order and `isTagRef` → `/^v?\d/` at line 39–41;
  `parseLsRemoteSha`, `checkTag`, `checkBranch`, `findNewerTags`,
  `fetchRemoteTagRefs`, and the module-standard `{ timeout: 15_000 }` all exist
  as described.
- `src/commands/list-detail.ts:133` — `canChangeVersion = isVersionTag(entry.ref) && updateStatus.status !== "check-failed"` — matches the Task 1.3 grounding exactly.
- `parseTagRefs` (`src/git-utils.ts`) strips `refs/tags/` and filters `^{}`, as the Task 1.1 Context states.

## Findings

None.

**Resolution**: No changes required. Plan approved as a faithful translation of
the specification.
