---
status: complete
created: 2026-07-02
cycle: 1
phase: Plan Integrity Review
topic: Update Check Fails On Branch Ref
---

# Review Tracking: Update Check Fails On Branch Ref - Integrity

## Outcome

**CLEAN** — no findings. The plan meets structural quality and implementation-readiness standards.

## Scope Reviewed

Single phase (`Phase 1: Remote-truth ref classification in update-check`), three tasks in a linear chain, read from the authoritative tick descriptions:

- `tick-e3e1f4` — Task 1.1: Add exact-path ls-remote probe parser
- `tick-4aea2f` — Task 1.2: Replace isTagRef dispatch with remote-truth classification in checkForUpdate
- `tick-feeadf` — Task 1.3: Confirm cross-surface recovery for the v4-style branch ref

Cross-checked against `src/update-check.ts`, `src/git-utils.ts`, `src/commands/list-detail.ts`, `src/version-resolve.ts`, and the referenced test files; and against the specification.

## Criterion-by-Criterion Assessment

1. **Task Template Compliance** — PASS. All three tasks carry Problem, Solution, Outcome, Do, Acceptance Criteria, Tests, Edge Cases, Context, and Spec Reference. Problem statements state WHY; Solution states WHAT; Outcome defines the verifiable end state. Acceptance criteria are concrete (exact ref names, exact reason strings, `{ timeout: 15_000 }`), and Tests include edge cases (peeled `^{}` line, prefix cross-match guard, slash-in-name, line-order independence, tiebreak, neither-found, network failure).

2. **Vertical Slicing** — PASS. Task 1.1 is a pure parser with 8 genuine behavioural unit tests (not mechanical boilerplate); Task 1.2 is the dispatch change verifiable via mocked git; Task 1.3 is cross-surface verification. Each is independently verifiable.

3. **Phase Structure** — PASS. Single phase, with an explicit and sound "Why this order" justification (one root cause, one dispatch decision, one cohesive TDD cycle; splitting cross-surface verification would create a checkpoint with no independent implementation).

4. **Dependencies and Ordering** — PASS. Linear chain 1.1 → 1.2 → 1.3. Task 1.2 consumes Task 1.1's `parseRefProbe`; Task 1.3 verifies Task 1.2's output. Tick creation timestamps (20:05:59 / 20:06:44 / 20:07:18) preserve authoring order, so the natural-ordering convention produces the correct execution sequence without explicit `blocked_by` edges. No convergence points requiring multiple predecessors, no cross-phase edges, no circular dependencies. Per the review criteria, missing explicit dependencies are not flagged where natural order already yields the correct sequence.

5. **Task Self-Containment** — PASS. Each task's Context pulls forward the relevant spec decisions (dispatch order, tiebreak precedence, error-handling terminality, branch-sha reuse requirement, mock-harness per-invocation branching). An implementer could execute any single task without reading the others.

6. **Scope and Granularity** — PASS. Each task is one TDD cycle. Do sections sit at or under the 5-step guidance and describe one cohesive change; none is trivial boilerplate.

7. **Acceptance Criteria Quality** — PASS. All criteria are pass/fail with specific boundary values and behaviours; none requires interpretation.

8. **External Dependencies** — N/A (bugfix).

## Grounding Verification (all confirmed against the codebase)

- `isTagRef` → `/^v?\d/` and its known-limitation comment exist at `src/update-check.ts:36-41`; single caller at line 75.
- `parseLsRemoteSha` (first-line only) at line 43; `findNewerTags` at 51; `checkBranch` `Branch '…' not found` at 120; `checkTag` `Tag '…' not found` at 147 — all as described.
- Dispatch steps 1–5 at lines 61-79 match the plan's "steps 1-3 untouched, 4-5 replaced".
- `execGit` and its `DEFAULT_TIMEOUT` default, plus `fetchRemoteTagRefs` issuing `ls-remote --tags` with `{ timeout: 15_000 }`, and `parseTagRefs` filtering `^{}` lines — all match Task 1.1/1.2 Context.
- `src/commands/list-detail.ts:132-133` gates `canChangeVersion = isVersionTag(entry.ref) && updateStatus.status !== "check-failed"` exactly as Task 1.3 quotes; `isVersionTag` exists at `src/version-resolve.ts:30`.
- All referenced test assertions exist where the tasks say: `ref type detection` block at `tests/update-check.test.ts:394` (`v1.2.3`/`1.0.0`), `--tags` single-call at 239, `Branch 'deleted-branch' not found` at 199, `Tag 'v2.0' not found` at 275; `notes check-failed` at `tests/commands/update.test.ts:358`, up-to-date block at 717, check-failed exit-1 at 733; branch-tracking `does NOT offer Change version` (`ref: "main"`) at `tests/commands/list-detail.test.ts:483`. `buildTagsOutput` helper exists at `tests/helpers/git-mocks.ts:30`.
- No dangling references; no contradictions between the plan's claims and the actual source.

## Test-Ownership Boundary Check

- Task 1.2 owns `tests/update-check.test.ts` (unit classification) and confirms `tests/update-check-unconstrained-regression.test.ts`.
- Task 1.3 owns the three cross-surface files (`update-check-all`, `commands/update`, `commands/list-detail`) plus the final full-suite green check.
- The only shared touchpoint is the unconstrained-regression file, referenced confirmation-only (not editing) in both tasks — no ownership conflict, no gap.

## Findings

None.
