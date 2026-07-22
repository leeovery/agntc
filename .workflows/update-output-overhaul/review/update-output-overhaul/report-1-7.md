TASK: 1.7 — Clone-fatal fan-out: group clone failure becomes N failed outcomes (update-output-overhaul-1-7)

ACCEPTANCE CRITERIA:
1. A group of N updating members whose clone throws produces exactly N failed outcomes, each keyed to its member.
2. No writeManifest, addEntry, or removeEntry call occurs for the clone-failed group (all N entries intact).
3. The N failed outcomes cause hasFailedOutcome to return true → runAllUpdates throws ExitSignal(1).
4. The orchestrator does not add its own retry loop; a single cloneSource rejection (after its internal retries) is treated as final.

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Repo Clone Dedup → Failure isolation & lifecycle → Clone failure (group-fatal)": cloneRepoOnce throws (network/auth/ref gone; cloneSource retries 3x internally, so a throw is final). Every member of the group becomes a `failed` outcome attributed to its own key. No manifest mutation — clone-failed removes no entries (only copy-failed does). Exit accounting unchanged — N failed outcomes trip hasFailedOutcome → non-zero exit. The one-grouped-line DISPLAY is Phase 2 (task 2-6); this task builds only the N-outcome MODEL. Acceptance 6.

IMPLEMENTATION:
- Status: Implemented (correct; one intentional, well-justified deviation from literal task text — see Notes)
- Location:
  - src/update-groups.ts:394-408 — processGroupUpdate wraps cloneRepoOnce in try/catch; on throw computes reason = errorMessage(err) once and returns { cloneFailed: true, reason, outcomes: members.map((m) => failedOutcome(m.key, reason)) }.
  - src/update-groups.ts:133-135 — failedOutcome single constructor producing `${key}: Failed — ${message}` (exact wording the task specifies).
  - src/update-groups.ts:410-417 — the reinstall loop + cleanupTempDir(tempDir) live in a try/finally that is only reached AFTER a successful clone, so the clone-failed path never touches cleanup (no tempDir to clean), matching the task.
  - src/clone-reinstall.ts:315-326 — cloneRepoOnce calls cloneSource once with no retry loop; retry is internal to cloneSource (git-clone.ts). Confirms criterion 4.
  - src/commands/update.ts:926-953 (persistUnitOutcomes) — only isSuccessOutcome → addEntry and copy-failed → removeEntry mutate; a group of only `failed` outcomes triggers no add/remove and skips writeManifest. Confirms criterion 2.
  - src/commands/update.ts:1015-1022 (hasFailedOutcome) — `failed` is in the membership set → ExitSignal(1) at update.ts:442-444. Confirms criterion 3.
- Notes:
  - The literal task text said `group.members.map(...)`, but its own parenthetical clarified "using the group attempted/updating member set." The implementation correctly uses the `members` param (the UPDATING subset), so up-to-date siblings are NOT marked failed. This is more correct than the literal text and aligns with the spec's `(N members)` = attempted set; it is covered by a dedicated unit test (tests/update-groups.test.ts:1014). This is a resolved contradiction in the task, implemented the right way.
  - The clone-failed reason is computed once and reused for every member's summary — no per-member re-derivation.

TESTS:
- Status: Adequate
- Coverage:
  - Criterion 1 (N outcomes, per-key): tests/update-groups.test.ts:968 "fans a clone-fatal rejection out to one failed outcome per member and skips cleanupTempDir" (asserts 3 outcomes, keys, all status=failed, exact summaries, and no cleanupTempDir / nuke / copy). tests/update-groups.test.ts:1014 asserts the fan-out spans the UPDATING subset, not group.members (up-to-date sibling excluded).
  - Criterion 2 (no manifest mutation): tests/commands/update.test.ts:3528 "mutates no manifest state for the clone-failed group" (no addEntry/removeEntry/writeManifest).
  - Criterion 3 (non-zero exit): tests/commands/update.test.ts:3541 "keeps N failed outcomes in the model so the run exits non-zero (ExitSignal 1)".
  - Criterion 4 (no extra retry / throw final): implied by the primitive (single cloneSource call) and demonstrated by the sibling-isolation tests, which use mockRejectedValueOnce for group A then mockResolvedValueOnce for group B — a retry of group A would consume group B's mock and break the accounting; both resolve exactly one clone call.
  - Sibling isolation (planned test "a sibling group still updates and persists"): tests/commands/update.test.ts:3553 and the capstone tests/commands/update.test.ts:4053 both verify group B streams/persists while group A (clone-failed) writes nothing and the run exits 1.
  - Extra (Phase-2 display, layered on the 1-7 model, confirms the model is intact): 3506 (enumerated grouped line, per-member warn lines gone), 3620 / 6986 (group-of-one collapses to one red spin.stop code-2 frame), 6904 (bare-failed renders red p.log.error, never warn).
- Notes:
  - All four planned Phase-1 test scenarios exist. Tests assert behaviour (outcome shape, manifest calls, exit code), not implementation internals.
  - Mild arrange overlap between update.test.ts:3553 (clone-failure describe block, display + persistence focus) and update.test.ts:4053 (hasFailedOutcome-membership capstone series, exit + no-removal focus). Each has a distinct home and framing; not redundant enough to flag as over-testing.

CODE QUALITY:
- Project conventions: Followed. Discriminated unions, exactOptionalPropertyTypes-safe optional spread (update-groups.ts:399), errorMessage helper, single-constructor pattern for the failed literal.
- SOLID principles: Good. failedOutcome is the single source of the `failed` literal + wording (DRY across all failure origins). processGroupUpdate has one clear responsibility; the additive GroupUpdateResult keeps the model (outcomes) separate from the display signal (cloneFailed).
- Complexity: Low. One try/catch for the clone, one try/finally for the loop; linear.
- Modern idioms: Yes.
- Readability: Good — strong, accurate doc comments explaining the no-mutation and no-retry invariants.
- Issues: None blocking.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] src/update-groups.ts:237 — the `cloneFailed: true` arm of GroupUpdateResult carries a `reason: string` field documented (update-groups.ts:228-234, 378-382) as feeding the render layer, but production never reads it: the >=2-member enumerated line (src/commands/update.ts:716-719) builds from member names via formatCloneFailureLine(label, affected), and the group-of-one collapsed line uses the failed outcome's own summary. `reason` is asserted only in a unit test (tests/update-groups.test.ts:990). It is orphaned scaffolding from the Phase-2 (task 2-6) wrapper — the concrete cleanup is to drop the field (and its lone test assertion) since each member's summary already embeds the reason. Tangential to 1-7's core model, which is correct and complete.
