# Review: configless-install-analysis-10-2

**Task:** Add path-traversal containment guard to update's stored sourceSubpath join
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Phase-5 copy-safety requires source-supplied path components fed into a join against the clone root to be lexically contained before first read. The add path already gates its selector subpath at step-2c (src/commands/add.ts:276-287). Cycle-9 introduced entry.sourceSubpath as a second source-derived component joined to the clone on update (resolveUpdateSourceDir, src/source-parser.ts:462-470), which lacked the mirrored pre-check. Restores symmetry as defense-in-depth (real exploitability nil — value internally-derived skills/<name>, never ..; symlink-escape scan still runs).

## Implementation — Implemented
- src/clone-reinstall.ts:366-379 (guard), :381 (join via resolveUpdateSourceDir). Uses assertSubpathWithinClone + PathTraversalError from src/copy-safety.ts (imported at :2).
- Guard gated by `if (entry.sourceSubpath)`, runs after successful clone (tempDir at :351) and BEFORE the join at :381 and before runPipeline (:383), which performs readConfig + derive-before-delete reads. Ordering correct: escaping subpath rejected pre-flight, no read at joined path.
- On PathTraversalError returns { status: "failed", failureReason: "clone-failed", message } via early return, bypassing runPipeline → no nuke, no copy. handleCopyFailedRemoval (:408) only removes the entry on copy-failed → install stays intact. finally still runs cleanupTempDir (correct).
- Non-PathTraversalError errors rethrown (:377) — no over-broad swallow.
- No-op when absent: the if-gate plus assertSubpathWithinClone's own null/undefined/empty guard (copy-safety.ts:37-39).
- Self-contained from analysis-9-1: edit confined to remote branch of cloneAndReinstall; resolveUpdateSourceDir untouched.

## Tests — Adequate (tests/clone-reinstall.test.ts)
- Escape (:1084-1127): sourceSubpath "../evil" → mocked assertSubpathWithinClone throws PathTraversalError; asserts call args, result failed/clone-failed, message contains "../evil" and "outside the clone root", AND readConfig/scanForEscapingSymlinks/nukeManifestFiles/copyBareSkill/copyPluginAssets NOT called.
- Install-intact (:1129-1156): removeEntry and writeManifest NOT called.
- Valid (:1158-1193): sourceSubpath "skills/go" → status success, copyBareSkill invoked with sourceDir "/tmp/agntc-clone/skills/go" (cycle-9 relocation preserved).
- Absent: covered at :1062-1082 and the cycle-9 fallback at :576-610.
- Real lexical predicate exhaustively tested in tests/copy-safety.test.ts; mocking the guard here is the correct unit boundary (verifies wiring/ordering, not the predicate).

## Code Quality
Discriminated-union result shape consistent; instanceof narrowing + rethrow matches add.ts:281-287; predicate stays in copy-safety.ts (single source); low complexity; comment block at :356-365 accurately explains the why. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
None.
