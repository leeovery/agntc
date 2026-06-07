TASK: configless-install-5-3 — Wire copy-safety pre-flight in runAdd/runCollectionPipeline before each copy: assertSubpathWithinClone(cloneRoot, targetPlugin) + symlink scan(unitDir, cloneRoot). Traversal no-op without selector; symlink scan every install. Members scanned independently. Violation → standalone cancel+ExitSignal(1) / member failed-result+continue; collection-add non-zero exit after committing siblings.

ACCEPTANCE CRITERIA: whole-repo runs symlink scan + no-op traversal; selector subpath escape → PathTraversalError pre-flight ExitSignal(1) named no write; valid subpath + escaping symlink → SymlinkEscapeError pre-flight; standalone scan boundary = clone root not unit dir; members scanned independently, violator failed siblings install; pre-flight before nuke/copy; copy mechanism unchanged; collection-add failed member → ExitSignal(1) after siblings+summary, skipped non-fatal.

STATUS: Complete

SPEC CONTEXT: Copy-Safety Hardening (pre-flight before any copy; complementary guards; boundary=clone root; no on-disk window); Error & Abort (pre-flight failures non-zero named; partial outcomes — failed member doesn't stop siblings, non-zero if any errored). Converged: scan routes through shared checkEscapingSymlinks discriminated result (analysis-4-2); lexical traversal hoisted ahead of detection/config (analysis-1-2).

IMPLEMENTATION: Implemented. src/commands/add.ts.
- Imports assertSubpathWithinClone, checkEscapingSymlinks, PathTraversalError (12-16); SymlinkEscapeError narrowing absorbed by wrapper.
- cloneRoot (231-234): unitDir = direct-path ? join(sourceDir,targetPlugin) : sourceDir; sourceDir = tempDir(221)/resolved local(208); scan boundary always sourceDir/cloneRoot never unitDir.
- Traversal guard (245-256): single assertSubpathWithinClone(sourceDir, direct-path?targetPlugin:undefined) at step 2c hoisted ahead of readConfig/detectType; catch PathTraversalError → identity-prefixed cancel + ExitSignal(1). Serves both standalone + direct-path member (single call, no dup).
- Standalone symlink pre-flight (344-357): await checkEscapingSymlinks(unitDir, sourceDir) step 9b BEFORE readManifest/nuke(360-364)/copy(390)/write(419); !ok → identity-prefixed cancel + ExitSignal(1).
- Collection member pre-flight (618-638): per member checkEscapingSymlinks(pluginDir, cloneRoot) BEFORE nuke/copy; !ok → results.push failed + continue.
- Deferred non-zero exit (756-763): after writeManifest(744)+summary(747), if results.some(failed) throw ExitSignal(1); skipped never triggers.
- Copy mechanism unchanged (copyUnit/toComputeInput gated only). cloneRoot threaded into pipeline as distinct field (296,454-456,625-628).

TESTS: Adequate. tests/commands/add.test.ts describe("copy-safety pre-flight") 6302-6796: whole-repo scan unitDir===cloneRoot===tempDir + no-op traversal undefined subpath (6304); local-path boundary (6323); tree-path boundary=clone root not unit dir (6341); selector subpath escape PathTraversalError ExitSignal(1) named no write (6371) + analysis-1-2 no readConfig/detectType at joined path (6504); valid subpath + escaping symlink SymlinkEscapeError pre-flight (6407); scan-before-nuke standalone (6429) + per-member (6653); traversal before readConfig/detectType (6456); members scanned independently (6588); violator failed sibling installs write+summary ExitSignal(1) (6604); write+summary before exit ordering (6632); skipped-only no exit (6682); direct-path member traversal vs clone root (6698); escaping direct-path aborts before pipeline reads configs (6752). Mock mirrors real wrapper faithfully. Behaviour-focused, not over-tested.

CODE QUALITY: Conventions followed (discriminated {ok}, instanceof only where real class needed). SOLID good (checkEscapingSymlinks SRP separated from surfacing; single hoisted traversal guard removes dup across pipelines — DRY). Complexity acceptable. Modern idioms. Readability good (comments at 344-352, 618-624, 756-760 explain boundary, deferred exit, skipped-vs-failed).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
