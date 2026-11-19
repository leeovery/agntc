TASK: 4.3 — Lock the ratified exit-code posture explicitly for check-failed / constrained-no-match (update-output-overhaul-4-3)

ACCEPTANCE CRITERIA:
- Single-key check-failed throws ExitSignal(1).
- Single-key constrained-no-match throws ExitSignal(1).
- All-mode check-failed (with succeeding siblings) resolves without throwing (exit 0), warns rather than errors, and mutates no manifest state for the failed group.
- All-mode constrained-no-match resolves without throwing (exit 0), warns, and leaves the entry untouched.
- All-mode aborted, blocked, failed, and copy-failed each throw ExitSignal(1); successful siblings still persist (partial-success), and no other status trips the non-zero exit.
- No source file is modified by this task (verification only).

STATUS: Complete

SPEC CONTEXT:
Spec "Safe-vs-Major Bump Gating → Exit-code posture — single-key vs all-mode (ratified, not changed)" pins an intentional mode divergence: single-key `update <key>` exits 1 on check-failed / constrained-no-match (the one targeted plugin's action didn't happen); all-mode warns and exits 0 for those (a batch isn't sunk by one dead remote / stuck constraint — partial success). "Per-Repo Clone Dedup → Failure isolation & lifecycle" ratifies that all-mode check-failed does not feed hasFailedOutcome, whose membership is exactly aborted | blocked | failed | copy-failed. Acceptance criterion 10 restates the matrix. This is a verification/regression task: author one named lock per matrix cell; no behaviour change.

IMPLEMENTATION:
- Status: Implemented (verification-only task; posture pre-existing, no source edits)
- Location:
  - Single-key check-failed → exit 1: src/commands/update.ts:161-164 (p.log.error + throw new ExitSignal(1)).
  - Single-key constrained-no-match → exit 1: src/commands/update.ts:182-187.
  - All-mode check-failed / constrained-no-match → p.log.warn (not error): src/commands/update.ts:979-985 (emitCollapsedGroupSummary); these outcomes are pushed into the flat outcomes[] (update.ts:432) but excluded from the exit gate.
  - hasFailedOutcome membership = exactly aborted | blocked | failed | copy-failed: src/commands/update.ts:1015-1023; the all-mode non-zero exit gate at :442-444.
- Notes: Source posture matches the ratified spec exactly. `git diff HEAD -- src/commands/update.ts src/summary.ts` is empty — no source modified, satisfying the verification-only constraint. (Spec's cited line numbers 139-142/160-165/623-631 are pre-drift; the logic is identical at the current lines above.)

TESTS:
- Status: Adequate
- Coverage: New describe block "ratified exit-code posture — safe-vs-major bump gating (task 4-3 regression lock)" at tests/commands/update.test.ts:3786-4248 contains all nine planned named cells, each asserting the exit explicitly:
  - :3829 "single-key check-failed exits 1" — ExitSignal code 1 + exact error string.
  - :3846 "single-key constrained-no-match exits 1" — ExitSignal code 1 + exact error string.
  - :3867 "all-mode check-failed warns and exits 0 (excluded from hasFailedOutcome), no manifest mutation" — err undefined (exit 0), warn contains the check-failed line, error NOT called, no addEntry/removeEntry for the failed group, sibling B persists (clone once, addEntry repo-b).
  - :3925 "all-mode constrained-no-match warns and exits 0, entry left untouched" — exit 0, warn line, error NOT called, no clone/write/add/remove.
  - :3957 "all-mode aborted exits 1 while the succeeded sibling persists" — ExitSignal(1) via derive-before-delete (mockAccess ENOENT on clone-a); removeEntry NOT called for A; addEntry + last-write contains B.
  - :4005 "all-mode blocked exits 1 while the succeeded sibling persists" — ExitSignal(1) via SymlinkEscapeError on clone-a; removeEntry NOT for A; B persists.
  - :4053 "all-mode failed (clone-failure fan-out) exits 1, no entries removed" — group-fatal clone reject fans to N failed; ExitSignal(1); removeEntry never called; B persists, no A addEntry.
  - :4102 "all-mode copy-failed exits 1, its entry removed, siblings persist" — copy throws post-nuke; ExitSignal(1); removeEntry(A); last-write A undefined, B defined.
  - :4154 capstone "no non-actioned status (...) trips the all-mode non-zero exit" — five groups (up-to-date / newer-tags / check-failed / constrained-no-match / skipped-no-agents) all resolve exit 0, each category verified genuinely produced (not swallowed by an early return), error never called.
- The block correctly keeps single-key arranges on checkForUpdate and all-mode arranges on the resolveGroupTarget group seam, per the task. Assertions verify the three properties that matter per cell: exit code, warn-vs-error, and manifest mutation/sibling persistence — they would fail if the posture drifted.
- Not under-tested: every ratified matrix cell has a named lock, plus a capstone pinning hasFailedOutcome membership as exactly the four hard failures.
- Not over-tested: the single-key cells (:3829, :3846) restate pre-existing coverage (:2235, :5668) and the hard-failure cells consolidate coverage that also lives in dedicated blocks (partial-success exit, symlink block, clone fan-out, copy-failed) — but this duplication is the explicit intent of the task ("one named lock per matrix cell so the posture cannot drift") and the block comment (:3810-3815) documents it. By-design, not redundant bloat.

CODE QUALITY:
- Project conventions: N/A (test-only task; test style matches the file's established arrange/act/assert + mock-seam conventions).
- SOLID principles: Good — tests target behaviour (exit code, log level, manifest calls) at the public runUpdate boundary, not internals.
- Complexity: Low — each cell is a focused arrange/act/assert.
- Modern idioms: Yes — `await runUpdate().catch((e) => e)` + instanceof/code assertions is the file's idiom.
- Readability: Good — the leading matrix comment (:3786-3816) makes the intent and cross-references explicit.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [do-now] tests/commands/update.test.ts:3995-4002 and :4044-4050 — the aborted/blocked cells assert "entry intact" only via `removeEntry not called with owner/repo-a`. Add a direct `expect((mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-a"]).toBeDefined()` to each, so "intact" (original entry preserved in the persisted manifest, not merely not-removed) is asserted positively alongside the sibling-persist check. Zero-risk assertion addition; passes as-is.
