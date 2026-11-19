TASK: Extract shared git mock helpers to tests/helpers/git-mocks.ts

ACCEPTANCE CRITERIA:
- Neither test file defines its own mockExecFile or buildTagsOutput
- tests/helpers/git-mocks.ts is the single source for both
- All existing tests pass unchanged

STATUS: Complete

SPEC CONTEXT: This is a refactoring/DRY task within the version-constraints feature. The two test files (update-check-constrained.test.ts and update-check-unconstrained-regression.test.ts) both needed identical mock helpers for simulating git ls-remote responses. Centralizing these into a shared module reduces duplication and ensures consistent mock behavior across constrained and unconstrained update-check test suites.

IMPLEMENTATION:
- Status: Implemented
- Location: tests/helpers/git-mocks.ts:1-35
- Notes: The shared module exports two functions:
  - `mockExecFile` (lines 4-28): Wraps `vi.mocked(childProcess.execFile)` with callback normalization to handle the overloaded execFile signature. Includes appropriate biome-ignore pragma for the `Function` type cast.
  - `buildTagsOutput` (lines 30-34): Formats an array of `{sha, tag}` objects into ls-remote-style output strings.
  Both test files import from `./helpers/git-mocks.js`:
  - tests/update-check-constrained.test.ts:4
  - tests/update-check-unconstrained-regression.test.ts:6
  Grep confirms zero local definitions of `mockExecFile` or `buildTagsOutput` in either target test file.

TESTS:
- Status: Adequate
- Coverage: This is a pure extraction refactoring. The helpers are exercised through all existing tests in both test files (10+ test cases in constrained, 11 in unconstrained-regression). No new test is needed for the helpers themselves -- they are tested indirectly through every test that uses them.
- Notes: No concerns. The helpers have no independent logic that warrants separate unit tests -- they are thin wrappers around vitest mock APIs.

CODE QUALITY:
- Project conventions: Followed. The file sits in `tests/helpers/` alongside the existing `factories.ts`, matching the established project pattern for shared test utilities.
- SOLID principles: Good. Single-purpose module with two cohesive, focused exports.
- Complexity: Low. Both functions are straightforward -- mockExecFile is a type-safe wrapper, buildTagsOutput is a one-liner formatter.
- Modern idioms: Yes. Proper TypeScript types, ES module exports, vitest mock patterns.
- Readability: Good. Clear function names, typed parameters, minimal code.
- Issues: None.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- tests/update-check.test.ts (the original/pre-constraint test file) still has its own local `mockExecFile` at line 11. This was not in scope for this task but represents a remaining DRY opportunity for a future cleanup pass. It does not define `buildTagsOutput`, but its `mockExecFile` is identical to the shared version.
