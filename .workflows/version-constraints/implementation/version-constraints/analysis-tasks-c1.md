---
topic: version-constraints
cycle: 1
total_proposed: 3
---
# Analysis Tasks: Version Constraints (Cycle 1)

## Task 1: Unify ConstrainedUpdateOverrides and UpdateActionOverrides into a single shared interface
status: pending
severity: medium
sources: duplication

**Problem**: Two structurally identical interfaces define `{ newRef: string; newCommit: string }` independently: `ConstrainedUpdateOverrides` in `src/commands/update.ts:194-197` and `UpdateActionOverrides` in `src/commands/list-update-action.ts:7-10`. They serve the same purpose -- overriding the ref/commit during a constrained update -- but are defined separately and must be kept in sync manually. The `list.ts` command also constructs this shape inline when passing to `executeUpdateAction`.

**Solution**: Define a single exported interface (e.g. `VersionOverrides`) in `src/version-resolve.ts` (which already hosts shared version-constraint logic) and import it in both `update.ts` and `list-update-action.ts`. Remove the two independent interface definitions.

**Outcome**: One canonical type for version override data. Changes to the override shape require editing one interface, not two.

**Do**:
1. In `src/version-resolve.ts`, add and export: `export interface VersionOverrides { newRef: string; newCommit: string; }`
2. In `src/commands/update.ts`, remove the `ConstrainedUpdateOverrides` interface (lines 194-197) and import `VersionOverrides` from `../version-resolve.js`. Update all usages of `ConstrainedUpdateOverrides` to `VersionOverrides`.
3. In `src/commands/list-update-action.ts`, remove the `UpdateActionOverrides` interface (lines 7-10) and import `VersionOverrides` from `../version-resolve.js`. Update all usages of `UpdateActionOverrides` to `VersionOverrides`.
4. In `src/commands/list.ts`, ensure the inline object passed to `executeUpdateAction` is typed against the shared `VersionOverrides` (may already work via inference).

**Acceptance Criteria**:
- Only one interface definition exists for the `{ newRef, newCommit }` override shape
- Both `update.ts` and `list-update-action.ts` import the shared type
- All existing tests pass without modification

**Tests**:
- TypeScript compilation succeeds with no type errors
- Existing tests for update command and list-update-action continue to pass (pure type refactor, no runtime change)

## Task 2: Remove duplicated mockExecFile from update-check.test.ts and use shared helper
status: pending
severity: medium
sources: duplication

**Problem**: `tests/update-check.test.ts:11-34` defines a local `mockExecFile` function that is nearly identical to the shared `mockExecFile` in `tests/helpers/git-mocks.ts:4-28`. The shared helper was extracted during a previous remediation cycle but `update-check.test.ts` was not migrated to use it. The local copy also defines `mockLsRemoteSuccess` and `mockLsRemoteFailure` convenience wrappers that could be built on top of the shared helper.

**Solution**: Remove the local `mockExecFile` from `update-check.test.ts` and import the shared one from `tests/helpers/git-mocks.ts`. Keep the local convenience wrappers (`mockLsRemoteSuccess`, `mockLsRemoteFailure`) but rewrite them to call the imported `mockExecFile`.

**Outcome**: One canonical `mockExecFile` implementation. Future changes to the exec-file mocking pattern require editing one file.

**Do**:
1. In `tests/update-check.test.ts`, add: `import { mockExecFile } from "./helpers/git-mocks.js";`
2. Remove the local `mockExecFile` function definition (lines 11-34).
3. Verify that the existing local `mockLsRemoteSuccess` and `mockLsRemoteFailure` functions (which call `mockExecFile`) still work with the imported version -- signatures are identical.
4. Run the test file to confirm all tests pass.

**Acceptance Criteria**:
- `update-check.test.ts` imports `mockExecFile` from `tests/helpers/git-mocks.ts`
- No local `mockExecFile` definition remains in `update-check.test.ts`
- All existing tests in `update-check.test.ts` pass

**Tests**:
- `npm test -- tests/update-check.test.ts` passes with all existing test cases

## Task 3: Restructure resolveTagConstraint to make bare-add / explicit-constraint mutual exclusion explicit
status: pending
severity: medium
sources: architecture

**Problem**: In `src/commands/add.ts:45-81`, the `resolveTagConstraint` function has two sequential blocks: the bare-add path (lines 52-64) and the explicit-constraint path (lines 67-77). Both call `fetchRemoteTags`. The mutual exclusion between them relies on the implicit contract that `updatedParsed.constraint` stays `null` through the bare-add path (the constraint is stored in a separate `derivedConstraint` variable). If someone refactored to set `updatedParsed.constraint` during the bare-add path, both blocks would fire and fetch tags twice from the same URL. This coupling is fragile.

**Solution**: Add an early return after the bare-add block succeeds, making the mutual exclusion explicit and eliminating any risk of the explicit-constraint block firing after a bare-add resolution. Alternatively, restructure as an if/else-if chain so the two branches are syntactically exclusive.

**Outcome**: The two resolution paths are visibly mutually exclusive. Refactoring one path cannot accidentally trigger the other. No risk of double `fetchRemoteTags` calls.

**Do**:
1. In `src/commands/add.ts`, restructure `resolveTagConstraint` so the bare-add and explicit-constraint blocks are in an if/else-if chain. The bare-add condition checks `ref === null && constraint === null`. The explicit-constraint condition checks `constraint != null`. Use `else if` to make the exclusion syntactic.
2. Alternatively, after the bare-add block resolves successfully (line 63), return early: `return { parsed: updatedParsed, constraint: derivedConstraint };` -- but this duplicates the return-shape construction. The if/else-if approach is cleaner.
3. Ensure the final `constraint` variable is still computed correctly in both paths.

**Acceptance Criteria**:
- The two tag-resolution branches are syntactically mutually exclusive (if/else-if or early return)
- Bare-add resolution still auto-applies `^{latest}` constraint
- Explicit constraint resolution still resolves best matching tag
- No double `fetchRemoteTags` call possible in any code path

**Tests**:
- Existing tests for `resolveTagConstraint` continue to pass (bare-add and explicit-constraint scenarios)
- Existing add command integration tests pass
