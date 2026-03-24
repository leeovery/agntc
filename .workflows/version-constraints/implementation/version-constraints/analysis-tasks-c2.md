---
topic: version-constraints
cycle: 2
total_proposed: 4
---
# Analysis Tasks: Version Constraints (Cycle 2)

## Task 1: Extract shared test factories to tests/helpers/factories.ts
status: approved
severity: medium
sources: duplication

**Problem**: The `makeEntry` factory is independently defined in 7 test files, `fakeDriver` mock is duplicated in 4 test files, and `makeManifest` is duplicated in 2 test files. These are structurally identical implementations with minor default-value variance. If `ManifestEntry` or `AgentDriver` interfaces change, all copies must be updated independently.

**Solution**: Create `tests/helpers/factories.ts` exporting `makeEntry(overrides?)`, `makeFakeDriver()`, and `makeManifest(key, entry)`. Each test file replaces its local factory with an import from the shared module.

**Outcome**: A single point of maintenance for test fixtures. ~120 lines of duplicated factory code removed across 7+ test files.

**Do**:
1. Create `tests/helpers/factories.ts`
2. Implement `makeEntry(overrides?: Partial<ManifestEntry>): ManifestEntry` with canonical defaults (ref: null, commit: a constant SHA, all required fields populated)
3. Implement `makeFakeDriver()` returning a fresh `AgentDriver` mock with the standard `detect`/`getTargetDir` implementation (skills -> `.claude/skills/`, agents -> `.claude/agents/`, hooks -> `.claude/hooks/`, else null)
4. Implement `makeManifest(key: string, entry: ManifestEntry)` returning `{ [key]: entry }`
5. In each of the 7 test files that define `makeEntry`, replace the local factory with `import { makeEntry } from "../helpers/factories.js"` (adjust relative path per file depth)
6. In each of the 4 test files that define `fakeDriver`, replace the local mock with `import { makeFakeDriver } from "../helpers/factories.js"` and call `makeFakeDriver()` where `fakeDriver` was used
7. In each of the 2 test files that define `makeManifest`, replace with the import
8. Run `pnpm test` -- all tests must pass with no changes to test behavior

**Acceptance Criteria**:
- No test file defines its own `makeEntry`, `fakeDriver`, or `makeManifest` factory
- `tests/helpers/factories.ts` is the single source for all three
- All existing tests pass unchanged
- Each test file still controls its own override values via the partial-overrides pattern

**Tests**:
- Run full test suite (`pnpm test`) -- all tests pass
- Verify no local `makeEntry`/`fakeDriver`/`makeManifest` definitions remain in test files (grep check)

## Task 2: Extract shared git mock helpers to tests/helpers/git-mocks.ts
status: approved
severity: low
sources: duplication

**Problem**: `mockExecFile` (a 15-line callback-normalization wrapper around `vi.mocked(childProcess.execFile)`) and `buildTagsOutput` (formats tag arrays into ls-remote output strings) are duplicated identically in `tests/update-check-constrained.test.ts` and `tests/update-check-unconstrained-regression.test.ts`. These are non-trivial helpers that must stay in sync.

**Solution**: Extract both helpers to `tests/helpers/git-mocks.ts`. Both test files import from the shared module.

**Outcome**: Single definition of git mock helpers, eliminating sync risk between the two update-check test files.

**Do**:
1. Create `tests/helpers/git-mocks.ts`
2. Move `mockExecFile` function into the new module, exporting it
3. Move `buildTagsOutput` function into the new module, exporting it
4. In `tests/update-check-constrained.test.ts`, replace local definitions with imports from `../helpers/git-mocks.js`
5. In `tests/update-check-unconstrained-regression.test.ts`, replace local definitions with imports from `../helpers/git-mocks.js`
6. Run `pnpm test` -- all tests must pass

**Acceptance Criteria**:
- Neither test file defines its own `mockExecFile` or `buildTagsOutput`
- `tests/helpers/git-mocks.ts` is the single source for both
- All existing tests pass unchanged

**Tests**:
- Run full test suite (`pnpm test`) -- all tests pass
- Verify no local `mockExecFile`/`buildTagsOutput` definitions remain in the two test files (grep check)

## Task 3: Add fetchRemoteTagRefs to git-utils.ts to expose full TagRef data
status: approved
severity: medium
sources: architecture

**Problem**: `fetchRemoteTags` in `git-utils.ts` returns `string[]` (tag names only), discarding the SHA data already parsed by `parseTagRefs`. Both `checkConstrained` and `checkTag` in `update-check.ts` need the full `TagRef[]` data, so they call `execGit` + `parseTagRefs` directly, bypassing the public API. This means the `ls-remote` invocation details (timeout, args) and parsing are wired up in two places: once in `fetchRemoteTags` and once in each caller in `update-check.ts`.

**Solution**: Add `fetchRemoteTagRefs(url): Promise<TagRef[]>` to `git-utils.ts` that returns the full parsed data. Redefine `fetchRemoteTags` as `fetchRemoteTagRefs(url).then(refs => refs.map(r => r.tag))`. Have `checkConstrained` and `checkTag` call `fetchRemoteTagRefs` instead of raw `execGit`.

**Outcome**: Single entry point for fetching and parsing remote tags. Callers that need SHAs use `fetchRemoteTagRefs`; callers that need names only use `fetchRemoteTags`. No more direct `execGit` + `parseTagRefs` wiring in `update-check.ts`.

**Do**:
1. In `src/git-utils.ts`, add and export `async function fetchRemoteTagRefs(url: string): Promise<TagRef[]>` that calls `execGit(["ls-remote", "--tags", url], { timeout: 15_000 })` and returns `parseTagRefs(stdout)`
2. Redefine `fetchRemoteTags` to call `fetchRemoteTagRefs(url).then(refs => refs.map(r => r.tag))`
3. In `src/update-check.ts`, replace the `execGit` + `parseTagRefs` call in `checkConstrained` (lines 162-165) with `const parsed = await fetchRemoteTagRefs(url)` and import `fetchRemoteTagRefs` from `git-utils.js`
4. In `src/update-check.ts`, replace the `execGit` + `parseTagRefs` call in `checkTag` (lines 126-129) with `const allTagRefs = await fetchRemoteTagRefs(url)` and derive `allTags` from it
5. Remove the now-unused `execGit` and `parseTagRefs` imports from `update-check.ts` if no other references remain
6. Run `pnpm test` -- all tests must pass

**Acceptance Criteria**:
- `fetchRemoteTagRefs` is exported from `git-utils.ts`
- `fetchRemoteTags` delegates to `fetchRemoteTagRefs`
- `update-check.ts` no longer calls `execGit` directly for tag fetching
- All existing tests pass unchanged

**Tests**:
- Run full test suite (`pnpm test`) -- all tests pass
- Verify `update-check.ts` does not import `execGit` for tag operations (grep check)
- Verify `fetchRemoteTagRefs` is used by both `checkConstrained` and `checkTag`

## Task 4: Show constraint expression in detail view
status: approved
severity: low
sources: architecture

**Problem**: The list view shows constrained plugins as `key  ^1.0 -> v1.2.3` with the constraint visible, but the detail view (`list-detail.ts:renderDetailView`) shows `Ref: v1.2.3` with no constraint information. The constraint context visible in the list vanishes when drilling into a plugin's detail view.

**Solution**: Add a `Constraint: ^1.0` info line in `renderDetailView` when `entry.constraint` is defined, placed alongside the existing Ref/Commit/Installed metadata lines.

**Outcome**: Constraint expression remains visible throughout the list drill-down flow, maintaining UX consistency.

**Do**:
1. In `src/commands/list-detail.ts`, in the `renderDetailView` function, after the `p.log.info(`Ref: ...`)` line (line 116), add a conditional: `if (entry.constraint) { p.log.info(`Constraint: ${entry.constraint}`); }`
2. Run `pnpm test` -- all tests must pass

**Acceptance Criteria**:
- Detail view displays `Constraint: <expression>` when the manifest entry has a constraint
- Detail view does not display a constraint line when the manifest entry has no constraint
- All existing tests pass unchanged

**Tests**:
- Run full test suite (`pnpm test`) -- all tests pass
- Manual verification: a constrained plugin's detail view shows the constraint expression
