TASK: Single-plugin constrained update execution

ACCEPTANCE CRITERIA:
- constrained-update-available triggers nuke-and-reinstall at new tag
- Constraint value preserved in manifest after update (not lost or changed)
- ref and commit updated to new resolved tag values
- constrained-up-to-date reports plugin is up to date
- constrained-no-match reports error, plugin left untouched
- Never downgrades -- if current ref is already the best within constraint, reports up-to-date

STATUS: Complete

SPEC CONTEXT:
The specification (Constrained Update Flow, lines 98-106) defines three outcomes when `constraint` is present: (1) same tag = up to date, (2) newer tag = nuke-and-reinstall at new tag with ref+commit updated but constraint unchanged, (3) no satisfying tag = error, plugin untouched. Additionally, "never downgrade" is stated: if maxSatisfying returns a tag that is not higher than the current ref, skip.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/update.ts:115-184 (runSingleUpdate function)
- Notes:
  - Lines 146-149: `constrained-up-to-date` correctly reports up-to-date via `p.outro()` and returns null newEntry (no manifest changes).
  - Lines 151-156: `constrained-no-match` logs error and throws ExitSignal(1), leaving plugin untouched.
  - Lines 158-174: `constrained-update-available` first checks `isAtOrAboveVersion` for the never-downgrade guard (line 159), then delegates to `runSinglePluginUpdate` with `newRef: result.tag, newCommit: result.commit` overrides.
  - Lines 194-217: `buildReinstallInput` correctly forwards the overrides (`newRef`, `newCommit`) to `cloneAndReinstall`.
  - Constraint preservation happens in the nuke-reinstall pipeline (src/nuke-reinstall-pipeline.ts:142-144) via `existingEntry.constraint` spread, which is correct since the entry object carries through.
  - Out-of-constraint info extraction (lines 95-113) is properly called for all constrained statuses.
  - The `runAllUpdates` function (lines 407-621) mirrors this logic for batch mode at lines 497-518.

TESTS:
- Status: Adequate
- Coverage:
  - "constrained-update-available -- single plugin" describe block (test lines 2305-2516): 6 tests covering nuke-and-reinstall trigger, newRef/newCommit passing, ref+commit update verification, constraint preservation, summary output, and never-downgrade guard.
  - "constrained-up-to-date -- single plugin" describe block (lines 2518-2571): 3 tests covering up-to-date message, no clone/nuke/write, and returns undefined.
  - "constrained-no-match -- single plugin" describe block (lines 2573-2630): 3 tests covering error reporting with ExitSignal(1), no clone/nuke/write, and no addEntry call.
  - Batch mode tests (lines 2632-3065): cover constrained-update-available in batch, constrained-up-to-date in batch, constrained-no-match in batch, mixed constrained statuses, mixed constrained + non-constrained, backward compat with no constraints, out-of-constraint collection, and never-downgrade in batch.
  - The `isAtOrAboveVersion` helper has its own dedicated test file (tests/is-at-or-above-version.test.ts) covering edge cases including null ref, non-semver refs, equal versions, and both directions.
  - Constraint preservation through the pipeline is also tested in tests/nuke-reinstall-pipeline.test.ts (lines 350-391).
- Notes: Tests are well-structured, each focused on a distinct acceptance criterion. Not over-tested -- each test verifies a different behavior rather than repeating the same assertion.

CODE QUALITY:
- Project conventions: Followed. Uses established patterns: ExitSignal for error exits, p.outro/p.log for UX output, mockable architecture via module mocking.
- SOLID principles: Good. runSingleUpdate has clear single responsibility (routing update check results). The ConstrainedUpdateOverrides interface cleanly separates the constrained path from the default path. buildReinstallInput extracts the input construction logic.
- Complexity: Low. Each status branch is a simple if-return block. The constrained-update-available path has one additional guard (isAtOrAboveVersion) which is well-isolated.
- Modern idioms: Yes. Uses discriminated union types for UpdateCheckResult, optional spread for overrides, proper TypeScript narrowing.
- Readability: Good. The flow through runSingleUpdate reads top-to-bottom with clear early returns for each status. The ConstrainedUpdateOverrides type documents intent.
- Issues: None found.

BLOCKING ISSUES:
(none)

NON-BLOCKING NOTES:
- The `constrained-no-match` handler in single-plugin mode (line 152-156) throws ExitSignal(1) which terminates immediately, while the batch mode (line 578-584) adds it to outcomes for summary display. This asymmetry is intentional (single = fail fast, batch = continue) and matches the pattern used by `check-failed`, but is worth noting for future maintainers.
