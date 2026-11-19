TASK: Constraint-absent entries remain unchanged

ACCEPTANCE CRITERIA:
- Tag ref entry without constraint uses old checkTag path (newer-tags or up-to-date, not constrained-*)
- Branch ref entry without constraint uses checkBranch (update-available or up-to-date)
- HEAD-tracking entry without constraint uses checkHead (update-available or up-to-date)
- Local entry without constraint returns { status: "local" } immediately
- No import from version-resolve is invoked for non-constrained entries (checkConstrained never called)
- All existing tests/update-check.test.ts tests pass unchanged

STATUS: Complete

SPEC CONTEXT: The specification (Manifest Storage > Update Routing) defines that entries without a `constraint` field preserve existing behavior: tag ref shows newer tags, branch ref tracks branch HEAD, null ref tracks HEAD, local returns immediately. The `constraint` field's absence is the sole signal that old logic applies. The spec also states (Manifest Storage > Migration): "No migration needed -- constraint is purely additive. Old manifest entries without it behave exactly as before."

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/update-check.ts:42-65
- Notes: The routing logic in `checkForUpdate` is correctly ordered:
  1. Line 46-48: Local check (`entry.ref === null && entry.commit === null`) -- returns before constraint check
  2. Line 52-54: Constraint guard (`entry.constraint !== undefined`) -- routes to `checkConstrained`
  3. Line 56-58: HEAD check (`entry.ref === null`) -- routes to `checkHead`
  4. Line 60-62: Tag check (`isTagRef(entry.ref)`) -- routes to `checkTag`
  5. Line 64: Branch fallthrough -- routes to `checkBranch`

  The guard `entry.constraint !== undefined` correctly prevents any non-constrained entry from reaching `checkConstrained`. The `ManifestEntry` type (/Users/leeovery/Code/agntc/src/manifest.ts:16) defines `constraint` as optional (`constraint?: string`), so it is `undefined` when absent. The `makeEntry` factory (/Users/leeovery/Code/agntc/tests/helpers/factories.ts:6-17) does not include a `constraint` field in its defaults, so entries created without an explicit `constraint` override will have `constraint === undefined`, correctly bypassing the guard.

TESTS:
- Status: Adequate
- Coverage:
  - Dedicated regression test file: /Users/leeovery/Code/agntc/tests/update-check-unconstrained-regression.test.ts (234 lines)
  - Tag ref without constraint: tests newer-tags result (line 23-44), up-to-date result (line 46-61), and spy verification that resolveVersion/resolveLatestVersion are never called (line 63-84)
  - Branch ref without constraint: tests update-available result (line 88-105), verifies git args target refs/heads/{branch} not --tags (line 107-124), and spy verification (line 126-143)
  - HEAD-tracking without constraint: tests update-available result (line 147-162), verifies git args target HEAD not --tags (line 166-183), and spy verification (line 185-202)
  - Local entry without constraint: tests local status returned immediately (line 206-215), verifies neither git nor resolveVersion called (line 218-232)
  - Additional regression coverage in /Users/leeovery/Code/agntc/tests/update-check-constrained.test.ts:179-213 (non-constrained entries within the constrained test file)
  - Original tests: /Users/leeovery/Code/agntc/tests/update-check.test.ts remains intact (448 lines, no constraint fields anywhere) -- all pre-existing paths are exercised without modification
- Notes: Tests verify behavior (correct status returned) AND verify the mechanism (version-resolve functions never invoked). The spy approach on `resolveVersion` and `resolveLatestVersion` is a correct proxy for verifying `checkConstrained` is not entered, since `checkConstrained` always calls `resolveVersion`. Tests are well-structured with clear describe blocks per entry type. No over-testing detected -- each test has a distinct purpose (behavior verification, git args verification, or spy verification).

CODE QUALITY:
- Project conventions: Followed. Uses vitest, proper vi.mock/vi.spyOn patterns, shared test helpers from factories.ts and git-mocks.ts.
- SOLID principles: Good. The guard clause pattern in `checkForUpdate` follows single responsibility -- each code path handles one entry type. The constraint check is inserted at the correct position in the routing chain without modifying existing paths.
- Complexity: Low. The routing logic is a simple linear chain of if-returns. No nesting, no complex conditionals.
- Modern idioms: Yes. Uses TypeScript optional properties (`constraint?: string`) for the absence signal rather than sentinel values. Uses `!== undefined` check rather than truthiness, which is correct since an empty string constraint would be invalid but should still route to the constrained path.
- Readability: Good. The checkForUpdate routing reads top-to-bottom as a priority chain. Comments in test entries ("// no constraint") make the intent explicit.
- Issues: None found.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The regression test file at update-check-unconstrained-regression.test.ts and the "non-constrained entries unaffected" section in update-check-constrained.test.ts have some overlapping coverage (both test tag-ref-without-constraint and branch-ref-without-constraint). This is minor and arguably provides defense-in-depth rather than being truly redundant, since the regression file also adds spy verification.
