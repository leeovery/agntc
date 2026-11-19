TASK: Remove duplicated mockExecFile from update-check.test.ts and use shared helper

ACCEPTANCE CRITERIA:
- update-check.test.ts imports mockExecFile from tests/helpers/git-mocks.ts
- No local mockExecFile definition remains in update-check.test.ts
- All existing tests in update-check.test.ts pass

STATUS: Complete

SPEC CONTEXT: This is a DRY remediation task from analysis cycle 1. The shared mockExecFile helper in tests/helpers/git-mocks.ts was extracted during a previous cycle but update-check.test.ts was not migrated to use it. The task eliminates the duplicated local definition.

IMPLEMENTATION:
- Status: Implemented
- Location: tests/update-check.test.ts:5 (import), tests/helpers/git-mocks.ts:4-28 (shared helper)
- Notes: The import at line 5 correctly pulls mockExecFile from the shared helper. No local mockExecFile definition exists anywhere in update-check.test.ts. The local convenience wrappers mockLsRemoteSuccess (lines 12-16) and mockLsRemoteFailure (lines 18-23) correctly call the imported mockExecFile with matching 4-parameter signatures (cmd, args, opts, cb). All direct mockExecFile calls throughout the test file (lines 147, 161, 172, 190, 206, 217, 240, 259, 280, 317, 336, 355, 369, 379, 396, 411) also use the correct 4-parameter pattern consistent with the shared helper's signature.

TESTS:
- Status: Adequate
- Coverage: This is a test-infrastructure refactoring task. The acceptance test is that all existing tests in update-check.test.ts continue to pass. The file contains 20 test cases across 7 describe blocks covering local installs, clone URL derivation, HEAD tracking, branch tracking, tag tracking, ls-remote failure, ls-remote output parsing, and ref type detection.
- Notes: No new tests are needed -- this is a pure refactoring of test infrastructure. The existing tests serve as the regression suite.

CODE QUALITY:
- Project conventions: Followed -- import path uses .js extension per ESM convention, consistent with other test files (update-check-constrained.test.ts, update-check-unconstrained-regression.test.ts)
- SOLID principles: Good -- single canonical implementation of mockExecFile (DRY principle satisfied)
- Complexity: Low -- straightforward import replacement
- Modern idioms: Yes -- ESM imports, vitest patterns
- Readability: Good -- the convenience wrappers mockLsRemoteSuccess and mockLsRemoteFailure remain local as they are test-file-specific, while the generic mockExecFile is correctly shared
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The git-clone.test.ts and git-utils.test.ts files have their own mockExecFileSuccess/mockExecFileFailure functions that could potentially also use the shared mockExecFile, but those are differently named and scoped -- not part of this task's scope.
