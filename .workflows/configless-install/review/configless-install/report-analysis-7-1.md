# Review: configless-install-analysis-7-1

**Task:** Extract shared copy-safety mock helper to stop six test files re-encoding production narrowing logic
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Test-only DRY consolidation of the Copy-Safety Hardening symlink-escape guard mock. Production checkEscapingSymlinks (src/copy-safety.ts:115-128) runs scanForEscapingSymlinks, narrows SymlinkEscapeError to { ok: false, message }, rethrows otherwise, returns { ok: true } on clean scan. No spec behaviour change.

## Implementation — Implemented
- Single authoring site: tests/helpers/copy-safety-mock.ts:53-74 (factory mockCopySafety); checkEscapingSymlinks body at 59-72 is control-flow-identical to production.
- All six consumers delegate via ...mockCopySafety(...):
  - tests/commands/add.test.ts:125-151 — full-replacement (local PathTraversalError/SymlinkEscapeError, own assertSubpathWithinClone vi.fn()), passes its local SymlinkEscapeError.
  - tests/commands/update.test.ts:76-84 — ...actual spread, actual.SymlinkEscapeError.
  - tests/commands/list-update-action.test.ts:82-90 — ...actual spread.
  - tests/commands/list-change-version-action.test.ts:53-61 — ...actual spread.
  - tests/clone-reinstall.test.ts:60-68 — ...actual spread + local assertSubpathWithinClone vi.fn().
  - tests/nuke-reinstall-pipeline.test.ts:28-36 — ...actual spread + local assertSubpathWithinClone vi.fn().
- Both module shapes supported via injected SymlinkEscapeErrorCtor parameter, preserving each site's instanceof semantics.
- assertSubpathWithinClone preserved (documented at copy-safety-mock.ts:24-29).
- No inline copy remains (grep for instanceof SymlinkEscapeError / return { ok: true } matches only the helper and the integration test, which runs the REAL scan).
- No production code changed.

## Tests — Adequate (task is itself a test refactor)
- Per-test drivability preserved in all six: each derives vi.mocked(scanForEscapingSymlinks) and drives it; both result arms (clean / rejected) exercised.
- No over-testing introduced.

## Code Quality
Matches existing dynamic-import-inside-async-vi.mock pattern; scoped/justified biome-ignore at :14. Clean dependency-inversion seam (ctor injection). Typed CheckResult union, JSDoc @links. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
None.
