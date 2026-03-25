AGENT: duplication
FINDINGS:
- FINDING: Out-of-constraint guard condition repeated across update.ts and list-detail.ts
  SEVERITY: medium
  FILES: src/commands/update.ts:103-107, src/commands/list-detail.ts:142-145
  DESCRIPTION: The same compound boolean condition — checking whether an UpdateCheckResult has status "constrained-update-available" or "constrained-up-to-date" AND latestOverall is not null — appears in two independently written files. In update.ts it is encapsulated in extractOutOfConstraint() (lines 98-116), while in list-detail.ts it is an inline conditional (lines 142-145). Both guard the same semantic: "does this constrained plugin have a newer version outside its constraint bounds?" The inline version in list-detail.ts also omits the entry.constraint check that update.ts includes, meaning the two guards diverge slightly and could drift further.
  RECOMMENDATION: Extract a type guard or predicate function (e.g. hasOutOfConstraintVersion(status: UpdateCheckResult): boolean) into update-check.ts alongside the UpdateCheckResult type. Both update.ts and list-detail.ts import and use the shared predicate. This consolidates the status-matching logic and prevents the two conditions from drifting independently.

- FINDING: Test SHA constants independently defined in 7 implementation test files
  SEVERITY: low
  FILES: tests/commands/list-change-version-action.test.ts:95-96, tests/commands/list-update-action.test.ts:91-92, tests/clone-reinstall.test.ts:90-91, tests/update-check.test.ts:9-10, tests/commands/update.test.ts:116-117, tests/update-check-constrained.test.ts:8-12, tests/update-check-unconstrained-regression.test.ts:10-11
  DESCRIPTION: Seven test files independently define the same fake SHA hash constants (INSTALLED_SHA/SHA_A as "a".repeat(40), REMOTE_SHA/SHA_B as "b".repeat(40), and variants SHA_C through SHA_E). These are the same values used for the same purpose — deterministic test fixtures for git commit SHAs. The naming inconsistency (INSTALLED_SHA vs SHA_A) across files adds confusion. The shared tests/helpers/factories.ts already exists and exports makeEntry/makeFakeDriver, making it a natural home for these constants.
  RECOMMENDATION: Export a set of named SHA constants (e.g. TEST_SHA_A through TEST_SHA_E) from tests/helpers/factories.ts. Each test file imports the shared constants. This removes 7 independent definitions and normalizes the naming.

- FINDING: Identical beforeEach mock-reset blocks in list-change-version-action.test.ts and list-update-action.test.ts
  SEVERITY: low
  FILES: tests/commands/list-change-version-action.test.ts:104-118, tests/commands/list-update-action.test.ts:96-110
  DESCRIPTION: Both test files have near-identical beforeEach blocks that reset the same set of mocks with the same default implementations: mockWriteManifest.mockResolvedValue(undefined), mockCleanupTempDir.mockResolvedValue(undefined), mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] }), mockGetDriver.mockReturnValue(fakeDriver), mockAddEntry.mockImplementation with the same spread pattern, and mockRemoveEntry.mockImplementation with the same destructuring pattern. These 15-line blocks were written by separate task executors and are character-for-character identical.
  RECOMMENDATION: Extract a setupDefaultMocks() function to tests/helpers/factories.ts or a new tests/helpers/mock-defaults.ts that accepts the mock references and applies the standard defaults. Each beforeEach calls the shared setup. The per-file mock variable declarations still need to be local (vitest constraint), but the default-value wiring can be shared. This is a modest improvement — the duplication is real but each block is ~15 lines.

SUMMARY: The most actionable finding is the out-of-constraint guard condition duplicated between update.ts and list-detail.ts, where the same semantic check was independently implemented with slight divergence. Test infrastructure has residual duplication in SHA constants and beforeEach blocks, both low severity.
