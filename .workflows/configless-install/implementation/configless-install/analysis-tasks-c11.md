---
topic: configless-install
cycle: 11
total_proposed: 2
---
# Analysis Tasks: Configless-Install (Cycle 11)

## Task 1: Extract update source-dir resolution into a shared tested function (resolveUpdateSourceDir)
status: approved
severity: medium
sources: architecture

**Problem**: The cycle-9 "where do I re-copy a member's source from on update" rule — `entry.sourceSubpath ? join(cloneRoot, entry.sourceSubpath) : getSourceDirFromKey(cloneRoot, key)` — lives inline in `cloneAndReinstall` (src/clone-reinstall.ts:388-390) and is re-authored verbatim in two integration tests (tests/integration/workflows.test.ts:764-766 case (f) and :858-860 case (g)). Both test copies carry a comment "Resolve the source dir EXACTLY as cloneAndReinstall:352 does" — but the production code is now at line ~388, not :352, so the comment is stale. The integration tests are pinned to a duplicated literal expression rather than the function, so the resolution rule and its tests can drift independently. This is test-quality consolidation, NOT an untested production seam: the production resolver branch (both the `sourceSubpath` path and the `getSourceDirFromKey` fallback, plus the cycle-10 `../evil` reject and the valid `skills/<name>` success) is already directly exercised at the `cloneAndReinstall(...)` level by clone-reinstall.test.ts.

**Solution**: Extract the resolution into one small pure function `resolveUpdateSourceDir(cloneRoot, key, sourceSubpath)` returning `sourceSubpath ? join(cloneRoot, sourceSubpath) : getSourceDirFromKey(cloneRoot, key)`. Have `cloneAndReinstall` call it, and have integration cases (f)/(g) call the SAME function instead of re-deriving the expression. Fix the stale `:352` comment. Optionally co-locate the cycle-10 path-traversal pre-check (assertSubpathWithinClone on sourceSubpath) adjacent to / behind the same seam so the guard and the join stay together — but only if it preserves the cycle-10 guard behaviour exactly (no regression). Behaviour must remain identical; full suite green.

**Outcome**: The source-dir resolution rule exists in exactly one place. Both integration tests and the production update path call the same `resolveUpdateSourceDir` function, so they cannot drift. No stale line-number comments remain. All existing behaviour (sourceSubpath-preferred resolution, key-derived fallback, cycle-10 path-traversal guard) is unchanged and the full test suite passes.

**Do**:
1. Add an exported pure function `resolveUpdateSourceDir(cloneRoot: string, key: string, sourceSubpath: string | undefined): string` returning `sourceSubpath ? join(cloneRoot, sourceSubpath) : getSourceDirFromKey(cloneRoot, key)`. Place it on the clone-reinstall or source-parser seam (source-parser already owns `getSourceDirFromKey` at src/source-parser.ts:443 and `assertSubpathWithinClone`, so it is a natural home; if placed in clone-reinstall, import `getSourceDirFromKey` as it already does at src/clone-reinstall.ts:13).
2. In `cloneAndReinstall`, replace the inline expression at src/clone-reinstall.ts:388-390 with a call to `resolveUpdateSourceDir(tempDir, key, entry.sourceSubpath)`.
3. In tests/integration/workflows.test.ts case (f) (lines ~761-766), replace the hand-copied expression assigned to `updateSourceDir` with a call to `resolveUpdateSourceDir(reclonedDir, key, entry.sourceSubpath)`, and remove/fix the stale `cloneAndReinstall:352` comment.
4. In tests/integration/workflows.test.ts case (g) (lines ~856-861), do the same: replace the hand-copied expression with `resolveUpdateSourceDir(reclonedDir, key, entry.sourceSubpath)`, keep the `expect(updateSourceDir).toBe(join(reclonedDir, "alpha"))` assertion (it now validates the shared function's fallback branch), and remove/fix the stale `:352` comment.
5. (Optional, only if zero behaviour change) Move the cycle-10 `assertSubpathWithinClone(tempDir, entry.sourceSubpath)` pre-check (src/clone-reinstall.ts:373-386) behind / adjacent to the same seam so guard + join are validated together. Preserve the exact cycle-10 abort semantics: a lexically-escaping recorded subpath (e.g. `../evil`) must still map to a `clone-failed` pre-flight result with no nuke and no copy. Do NOT change the guard's behaviour, error mapping, or the no-op-when-absent rule.
6. Run typecheck (`tsc --noEmit`) and the full test suite; confirm all tests pass.

**Acceptance Criteria**:
- A single exported `resolveUpdateSourceDir(cloneRoot, key, sourceSubpath)` function exists and is the only place the `sourceSubpath ? join(...) : getSourceDirFromKey(...)` rule is authored.
- `cloneAndReinstall` calls `resolveUpdateSourceDir` rather than inlining the expression.
- Integration cases (f) and (g) call `resolveUpdateSourceDir` rather than re-deriving the expression.
- No `:352` (or any stale line-number) comment remains referencing the resolution rule.
- The cycle-10 path-traversal guard behaviour is unchanged: `../evil`-style escaping sourceSubpath still aborts pre-flight (clone-failed, no nuke, no copy, install intact); absent/empty sourceSubpath is a no-op.
- `tsc --noEmit` clean; full suite green (1519 tests, no new failures).

**Tests**:
- Existing clone-reinstall.test.ts cloneAndReinstall-level tests (sourceSubpath-preferred success at `skills/<name>`, key-derived fallback, and the cycle-10 `../evil` reject) continue to pass unchanged — they prove the production caller still resolves correctly through the new function.
- Integration cases (f) and (g) in tests/integration/workflows.test.ts continue to pass, now exercising the shared `resolveUpdateSourceDir` (case (f): sourceSubpath `skills/alpha` resolves to the relocated dir and re-copies the new reference file; case (g): no sourceSubpath falls back to `<clone>/alpha`).
- Add a focused unit test for `resolveUpdateSourceDir` covering both branches: (a) with a sourceSubpath returns `join(cloneRoot, sourceSubpath)`; (b) without a sourceSubpath returns `getSourceDirFromKey(cloneRoot, key)`.
- If the optional guard co-location is done: a unit/integration test confirming an escaping sourceSubpath is rejected before any join/nuke (cycle-10 behaviour preserved).

## Task 2: Extract the shared list-action test harness into tests/helpers
status: approved
severity: medium
sources: duplication

**Problem**: The two list-action test files — tests/commands/list-update-action.test.ts:1-136 and tests/commands/list-change-version-action.test.ts:1-137 — share an essentially byte-identical ~130-line preamble: the `@clack/prompts` / `manifest` / `git-clone` / `config` / `type-detection` / `nuke-files` / `copy-plugin-assets` / `copy-bare-skill` / `drivers/registry` / `node:fs/promises` / `copy-safety` `vi.mock` factories, the full block of `vi.mocked(...)` handle declarations, the `INSTALLED_SHA` / `REMOTE_SHA` constants, the `fakeDriver`, and the `beforeEach` body. The only divergences are: change-version adds `fetchRemoteTags` + `select` / `isCancel` mocks plus an `mockIsCancel.mockReturnValue(false)` line in beforeEach, while list-update adds `stat`. The `aborted` and `blocked` test cases (list-update-action.test.ts:557-629, list-change-version-action.test.ts:535-615) are also near-verbatim copies. Each future change to the shared pipeline's dependency surface must be hand-mirrored in both files — the copy-paste-drift risk the prior cycles' clack-mock.ts / copy-safety-mock.ts / factories.ts helpers were created to remove, but the mock-wiring/beforeEach layer above those helpers was never extracted. This matches the cycle-7 precedent for test-harness consolidation.

**Solution**: Extract the shared list-action test harness into a `tests/helpers/` module (e.g. `setupCloneReinstallMocks()` / `installCloneReinstallBeforeEach()`): a setup function registering the common beforeEach defaults and returning the shared `vi.mocked` handles, plus consolidation of the common `vi.mock` factory set. The change-version file layers only its extra `select` / `isCancel` / `fetchRemoteTags` mocks (and `mockIsCancel.mockReturnValue(false)`) on top; the list-update file layers only its extra `stat` mock on top. This mirrors the existing mockClack / mockCopySafety extraction one level up. Pure test-support consolidation — no behaviour change; full suite green.

**Outcome**: The common list-action mock-wiring, handle declarations, constants, fakeDriver, and beforeEach defaults live in one `tests/helpers/` module. Both test files import the shared harness and add only their file-specific mocks. A future change to the clone-reinstall dependency surface is made once in the helper rather than mirrored in two files. No behaviour change; all list-action tests (and the full suite) still pass.

**Do**:
1. Create a `tests/helpers/` module (e.g. `tests/helpers/list-action-mocks.ts`) exporting: (a) a helper that consolidates the common `vi.mock` factory set shared by both files (manifest, git-clone, config, type-detection, nuke-files, copy-plugin-assets, copy-bare-skill, drivers/registry, copy-safety, plus clack via the existing mockClack helper); (b) a `beforeEach`-defaults installer registering the shared defaults currently in list-update-action.test.ts:106-125 (`vi.clearAllMocks`, `mockWriteManifest`/`mockCleanupTempDir`/`mockNukeManifestFiles`/`mockGetDriver`/`mockAccess`/`mockScanForEscapingSymlinks` defaults, and the `mockAddEntry`/`mockRemoveEntry` implementations); (c) the shared `INSTALLED_SHA` / `REMOTE_SHA` constants and `fakeDriver` (or a factory for them), reusing the existing `makeEntry` / `makeFakeDriver` from tests/helpers/factories.ts. The setup should return (or expose) the shared `vi.mocked` handles needed by both files.
   - NOTE: respect Vitest hoisting — `vi.mock` factory calls are hoisted; structure the helper so the shared factory registration still works correctly from both test files (e.g. each file calls the registration helper at module top exactly as the inline `vi.mock` blocks run today, mirroring how clack-mock.ts / copy-safety-mock.ts are consumed inside `vi.mock(...)` factories).
2. Refactor tests/commands/list-update-action.test.ts to consume the shared harness, adding only its file-specific `stat` mock (and the `stat`/`access` import + `mockStat` handle).
3. Refactor tests/commands/list-change-version-action.test.ts to consume the shared harness, adding only its file-specific `fetchRemoteTags`, `select`, `isCancel` mocks, the `mockIsCancel.mockReturnValue(false)` default, and the `makeNewerTagsStatus` helper.
4. Optionally consolidate the near-verbatim `aborted` / `blocked` test cases (list-update-action.test.ts:557-629, list-change-version-action.test.ts:535-615) into a shared parametrised helper if it can be done without changing what each assertion verifies; otherwise leave them but ensure the shared mock-handle surface is reused.
5. Run typecheck (`tsc --noEmit`) and the full test suite; confirm all tests pass with no change in test count or coverage of the two files.

**Acceptance Criteria**:
- A shared `tests/helpers/` module exists holding the common list-action `vi.mock` factory set, the shared `vi.mocked` handle wiring, the `INSTALLED_SHA` / `REMOTE_SHA` constants, the `fakeDriver`, and the common beforeEach defaults.
- tests/commands/list-update-action.test.ts and tests/commands/list-change-version-action.test.ts both consume the shared harness and contain only their file-specific divergences (list-update: `stat`; change-version: `fetchRemoteTags` + `select` + `isCancel` + `mockIsCancel.mockReturnValue(false)`).
- The ~130-line near-identical preamble is no longer duplicated across the two files.
- No production code is changed; this is test-support-only.
- `tsc --noEmit` clean; full suite green (1519 tests, no new failures, no reduction in coverage of executeUpdateAction / executeChangeVersionAction).

**Tests**:
- All existing executeUpdateAction tests in list-update-action.test.ts continue to pass unchanged after consuming the shared harness.
- All existing executeChangeVersionAction tests in list-change-version-action.test.ts continue to pass unchanged after consuming the shared harness (including tag presentation, isCancel defaulting, and the change-version-specific cases).
- The `aborted` and `blocked` cases in both files continue to verify the same outcomes (whether consolidated into a shared helper or left in place).
- No new behavioural tests are required (pure test-support refactor); the assertion that the suite count and pass state are identical pre/post is the regression guard.

## Discarded findings (noted, not proposed)

- architecture MEDIUM "orchestrators only mock-tested; no e2e integration driving runAdd/runCollectionPipeline/cloneAndReinstall" — test-STRATEGY change, not a defect; established project approach is command-level mocked unit tests + unit-level integration tests. Out of scope / below the action bar.
- architecture LOW "clone-URL fallback derivation twice (buildParsedSourceFromKey vs deriveCloneUrlFromKey)" — KNOWN RECURRENCE (c10 architecture LOW). Below threshold.
