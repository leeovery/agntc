TASK: configless-install-analysis-1-2 — Move the lexical path-traversal guard (assertSubpathWithinClone) to immediately after unitDir is computed, so an attacker-controlled ..-escaped direct-path selector is rejected before any filesystem read at the joined path (single-plugin + collection direct-path). Keep symlink scan at 9b.

ACCEPTANCE CRITERIA: guard fires before readConfig/detectType; runs for both direct-path paths; symlink scan remains pre-copy; valid sources still install.

STATUS: Complete

SPEC CONTEXT: Copy-Safety Hardening (guard timing pre-flight, "validate before you mutate"; path-traversal validates subpath within clone before any copy, pure lexical mirroring Vercel isSubpathSafe); Error & Abort (pre-flight failure non-zero named). Analysis sharpens spec's "before copy" to "before any read at the joined path."

IMPLEMENTATION: Implemented (matches prescribed solution exactly). src/commands/add.ts.
- :231-234 unitDir computed (step 2b); :245-256 guard at step 2c immediately after, try/catch maps PathTraversalError → identity-prefixed p.cancel + ExitSignal(1), non-PathTraversalError rethrows.
- :260 readConfig + :267 detectType (first reads of unitDir) strictly after guard.
- :293-305 collection branch enters runCollectionPipeline only after detection; pipeline carries no separate assertSubpathWithinClone (relies on earlier check). Grep confirms only invocation site is line 246.
- :353 (standalone) + :625 (member loop) checkEscapingSymlinks left at 9b/per-member (boundary sourceDir/cloneRoot not unitDir, unchanged).
- Guard passes sourceDir (true clone root) + targetPlugin only for direct-path (else undefined → no-op). isContained relative()-based, no fs access → genuinely before any attacker-controlled read.

TESTS: Adequate. tests/commands/add.test.ts: guard BEFORE readConfig/detectType order[0]==="guard", called (tempDir,"pluginA") (6456); escaping selector aborts BEFORE reads — readConfig/detectType not.toHaveBeenCalled + no nuke/copy/write (6504); escaping direct-path collection aborts BEFORE pipeline reads member configs — no readConfig/detectType/selectCollectionPlugins/write (6752); valid direct-path collection runs guard vs clone root (6698); whole-repo no-op guard (tempDir,undefined) (6304); valid tree-path validates vs clone root (6341). copy-safety.test.ts:21-122 unit coverage of assertSubpathWithinClone. Moving guard back below reads would flip ordering + not-called assertions. Behaviour-focused, not over-tested.

CODE QUALITY: Conventions followed (single guard invocation, narrow typed catch + rethrow, mirrors TypeConflictError handler). SOLID good (assertSubpathWithinClone pure lexical SRP separate from I/O symlink scan; runAdd orchestrates). Complexity low. Modern idioms (instanceof narrowing, discriminated-union). Readability good (step-2c comment documents why guard precedes first read; 9b comment cross-references; collection comment explains no re-check).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
