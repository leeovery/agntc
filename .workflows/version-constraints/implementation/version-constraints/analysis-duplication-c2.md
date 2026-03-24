AGENT: duplication
FINDINGS:
- FINDING: makeEntry test factory duplicated across 7 test files
  SEVERITY: medium
  FILES: tests/commands/list-change-version-action.test.ts:96, tests/commands/list-update-action.test.ts:92, tests/commands/list-detail.test.ts:31, tests/commands/update.test.ts:117, tests/nuke-reinstall-pipeline.test.ts:57, tests/update-check-constrained.test.ts:14, tests/update-check-unconstrained-regression.test.ts:12
  DESCRIPTION: Each test file independently defines a makeEntry(overrides) factory that creates a ManifestEntry with spread-based overrides. The implementations are structurally identical -- they all spread a base ManifestEntry with caller-provided partial overrides. The only variance is in the default values for ref and commit (some default to null, some to "v1.0.0", some to SHA constants). Seven independent copies means seven places to update if ManifestEntry gains or changes a required field.
  RECOMMENDATION: Extract a shared makeEntry factory to a tests/helpers/factories.ts module. Use a single canonical default (e.g. ref: null, commit: SHA_A) and let each test file override as needed via the existing partial-overrides pattern. Each test file replaces its local factory with an import.

- FINDING: fakeDriver mock object duplicated across 4 test files
  SEVERITY: medium
  FILES: tests/commands/list-change-version-action.test.ts:116, tests/commands/list-update-action.test.ts:108, tests/commands/update.test.ts:129, tests/nuke-reinstall-pipeline.test.ts:47
  DESCRIPTION: Four test files define an identical fakeDriver object with detect/getTargetDir mocks. The getTargetDir implementation (mapping "skills" to ".claude/skills", "agents" to ".claude/agents", "hooks" to ".claude/hooks", else null) is repeated verbatim in each file. This is tightly coupled to the AgentDriver interface -- if the interface changes, all four copies need updating.
  RECOMMENDATION: Extract fakeDriver to the same tests/helpers/factories.ts module. Export as a function (e.g. makeFakeDriver()) that returns a fresh mock each time, so tests remain isolated.

- FINDING: mockExecFile and buildTagsOutput helpers duplicated across 2 test files
  SEVERITY: low
  FILES: tests/update-check-constrained.test.ts:26, tests/update-check-unconstrained-regression.test.ts:24
  DESCRIPTION: Both update-check test files define identical mockExecFile and buildTagsOutput helper functions. mockExecFile is a 15-line wrapper around vi.mocked(childProcess.execFile) that handles the callback parameter normalization. buildTagsOutput formats tag arrays into ls-remote output strings. These are non-trivial helpers that must stay in sync.
  RECOMMENDATION: Extract both helpers to a tests/helpers/git-mocks.ts module. Both test files import from the shared module.

- FINDING: makeManifest test factory duplicated across 2 test files
  SEVERITY: low
  FILES: tests/commands/list-change-version-action.test.ts:108, tests/commands/list-update-action.test.ts:104
  DESCRIPTION: Both files define an identical one-liner makeManifest(key, entry) that returns { [key]: entry }. While trivial individually, it exists alongside the other duplicated factories and would naturally consolidate with them.
  RECOMMENDATION: Include in the shared tests/helpers/factories.ts alongside makeEntry.

- FINDING: vi.mock blocks for @clack/prompts repeated across 6 test files
  SEVERITY: low
  FILES: tests/commands/add.test.ts:15, tests/commands/list-change-version-action.test.ts:6, tests/commands/list-update-action.test.ts:6, tests/commands/list.test.ts:6, tests/commands/update.test.ts:13, tests/commands/list-detail.test.ts:5
  DESCRIPTION: Six test files define nearly identical vi.mock("@clack/prompts") blocks with the same mock structure (intro, outro, spinner, select, isCancel, log with info/warn/error/success/message, cancel). Minor variations exist (some include select/isCancel, some do not). This is a standard vitest pattern where vi.mock must be called at the top level per file, so extraction to a shared module is constrained by vitest's hoisting semantics. However, the mock factory function itself can be shared.
  RECOMMENDATION: This is borderline -- vitest requires vi.mock at the top of each file, limiting how much can be shared. A shared factory function (e.g. createClackMock()) could reduce the object literal duplication, but the ergonomic gain is modest. Flag for awareness; consolidation is optional.

SUMMARY: The primary duplication is in test infrastructure -- makeEntry, fakeDriver, mockExecFile, and buildTagsOutput factories are independently implemented across 7+ test files. Extracting these to a shared tests/helpers/ module would reduce ~150 lines of repetition and create a single point of maintenance for ManifestEntry and AgentDriver test fixtures. Source code itself is clean with no significant cross-file duplication remaining after cycle 1 extractions.
