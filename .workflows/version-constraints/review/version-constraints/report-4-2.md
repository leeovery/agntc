TASK: Constraint-aware status hints in list view

ACCEPTANCE CRITERIA:
- constrained-update-available shows update available hint with target version
- constrained-up-to-date shows up-to-date hint
- constrained-up-to-date with outOfConstraint shows info about newer version outside bounds
- constrained-no-match shows error hint
- All existing non-constrained status hints unchanged

STATUS: Complete

SPEC CONTEXT: The specification (List Command Integration > Update status) requires differentiating between "update available within constraint" and "newer version outside constraint" -- same distinction as the update output info line. The three constrained statuses from Phase 3 carry the data needed: tag, latestOverall, and status.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/list.ts:29-58
- Notes:
  - `formatStatusHint` switch handles all 8 `UpdateCheckResult` statuses
  - `constrained-update-available` (line 46-49): Returns `"\u2191 Update available \u2192 ${result.tag}"` with optional `"(${latestOverall} outside constraint)"` suffix via `formatOutOfConstraint` helper
  - `constrained-up-to-date` (line 50-55): Returns `"\u2713 Up to date"` when `latestOverall` is null; returns `"\u2713 Up to date (${latestOverall} available outside constraint)"` when non-null
  - `constrained-no-match` (line 56-57): Returns `"\u2717 No matching version"`
  - `formatOutOfConstraint` helper (line 29-32) extracts the out-of-constraint suffix logic for reuse in the `constrained-update-available` case
  - All five original non-constrained cases (lines 36-45) are unchanged
  - Switch is exhaustive -- no default case; TypeScript discriminated union ensures completeness
  - Minor deviation from plan: plan suggested `constrained-no-match` would show `"No tags match ${constraint}"` including the constraint expression, but the actual `UpdateCheckResult` type for `constrained-no-match` does not carry a `constraint` field, so the implementation correctly shows a generic `"No matching version"`. This is consistent with the type definition in `/Users/leeovery/Code/agntc/src/update-check.ts:18`
  - Minor deviation from plan: plan referenced `outOfConstraint.latest` property shape but actual type uses `latestOverall: string | null`. Implementation correctly adapts to the actual Phase 3 type

TESTS:
- Status: Adequate
- Coverage:
  - `constrained-update-available` without out-of-constraint: tested (list.test.ts:876-907)
  - `constrained-update-available` with out-of-constraint: tested (list.test.ts:971-1002)
  - `constrained-up-to-date` without out-of-constraint: tested (list.test.ts:909-938)
  - `constrained-up-to-date` with out-of-constraint: tested (list.test.ts:940-969)
  - `constrained-no-match`: tested (list.test.ts:1004-1032)
  - All five non-constrained statuses: tested in a single comprehensive test (list.test.ts:830-874)
- Notes:
  - Tests exercise the function through the full `runListLoop` integration path (intercepting the `p.select` mock's options argument), which is a good pattern -- tests verify what the user sees
  - Tests would fail if any constrained hint broke (they assert exact string equality)
  - Test count matches plan expectations (6 tests covering constrained + 1 test covering all non-constrained unchanged)
  - The `formatStatusHint` function is not exported and tested directly; instead it is tested through `runListLoop`. This is reasonable given the function is small and the integration path is the real consumer

CODE QUALITY:
- Project conventions: Followed -- consistent with the existing switch pattern and Unicode character usage for status icons
- SOLID principles: Good -- `formatStatusHint` has single responsibility (map status to string); `formatOutOfConstraint` extracted as helper avoids inline duplication
- Complexity: Low -- simple switch with straightforward string formatting
- Modern idioms: Yes -- discriminated union + exhaustive switch, block-scoped cases with braces where intermediate variables are needed
- Readability: Good -- clear intent, consistent formatting across all cases
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The plan specified `constrained-no-match` should include the constraint expression in the hint (e.g., "No tags match ^1.0"), but since the `UpdateCheckResult` type for this status does not carry a `constraint` field, the generic "No matching version" is the correct adaptation. If the constraint expression is desired in the future, the type would need to be extended first.
