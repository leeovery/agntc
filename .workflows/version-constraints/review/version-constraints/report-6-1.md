TASK: Extract shared test factories to tests/helpers/factories.ts

ACCEPTANCE CRITERIA:
- No test file defines its own makeEntry, fakeDriver, or makeManifest factory
- tests/helpers/factories.ts is the single source for all three
- All existing tests pass unchanged
- Each test file still controls its own override values via the partial-overrides pattern

STATUS: Complete

SPEC CONTEXT: This task is a test infrastructure refactoring within the version-constraints work unit. It consolidates duplicated factory functions that were independently defined across multiple test files. Not directly tied to a spec feature but supports maintainability of the test suite that covers version constraint functionality.

IMPLEMENTATION:
- Status: Implemented
- Location: tests/helpers/factories.ts:1-42
- Notes:
  - `makeEntry(overrides?: Partial<ManifestEntry>)` exported at line 5 with sensible defaults (ref: null, commit: 40x"a", installedAt, agents: ["claude"], files, cloneUrl: null)
  - `makeManifest(keysOrEntries: string[] | Record<string, ManifestEntry>)` exported at line 19, supports both array-of-keys (creates default entries) and record (shallow copy) patterns
  - `makeFakeDriver()` exported at line 32, returns mock with `detect` and `getTargetDir` stubs covering skills/agents/hooks asset types
  - All three use proper TypeScript types imported from source (`ManifestEntry`, `Manifest`, `AssetType`)
  - Grep confirms zero local factory definitions in any test file -- only the shared module defines these functions
  - 12 test files import from the shared factories module
  - `const fakeDriver = makeFakeDriver()` usages in test files are invocations of the imported factory, not local definitions

TESTS:
- Status: Adequate
- Coverage: This is a test infrastructure refactoring. The verification is that the full test suite passes with no changes to test behavior. No new unit tests are needed for test helpers themselves.
- Notes: The acceptance criteria correctly identifies "pnpm test -- all tests pass" as the test verification for this refactoring task.

CODE QUALITY:
- Project conventions: Followed -- uses `.js` extension in imports (ESM), proper type-only imports, vitest patterns
- SOLID principles: Good -- single responsibility (one module for test factories), open for extension via overrides pattern
- Complexity: Low -- each factory is a simple spread-merge or conditional
- Modern idioms: Yes -- `Partial<T>` for overrides, spread operator, discriminated union input (`string[] | Record`)
- Readability: Good -- self-documenting function names, clear parameter semantics
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The `makeManifest` signature (`keysOrEntries: string[] | Record<string, ManifestEntry>`) is more flexible than the plan's described `makeManifest(key, entry)`. This is a positive deviation -- it supports both the convenience pattern (array of keys with default entries) and the explicit pattern (pre-built record). Currently only the array form is used in tests (list.test.ts), so the Record branch is technically untested by call sites, but it is trivial code.
