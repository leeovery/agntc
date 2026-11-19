TASK: configless-install-5-4 — Thread clone-root boundary through update pipeline; run symlink-escape pre-flight (via shared checkEscapingSymlinks) before nukeManifestFiles in executeNukeAndReinstall. Violation → pre-flight failure via existing seam (install intact, non-zero, named), NOT via handleCopyFailedRemoval. No path-traversal guard on update.

ACCEPTANCE CRITERIA: NukeReinstallOptions carries cloneRoot threaded from cloneAndReinstall (clone→tempDir, local→sourceDir) through runPipeline; scan(sourceDir,cloneRoot) BEFORE nuke; escaping symlink aborts before removal (no nuke/copy, install+entry intact); surfaced via seam non-zero named; NOT via handleCopyFailedRemoval (entry not removed); member subdir scanned vs clone root (within-clone links allowed); no path-traversal guard on update; copy mechanism unchanged.

STATUS: Complete

SPEC CONTEXT: Copy-Safety Hardening (guard runs on update re-copy, pre-flight before any copy, boundary=cloned repo root, broken links lexical); Error & Abort (pre-flight non-zero named; update-abort install intact entry not removed); Manifest Keying & Lifecycle (derive-before-delete). Converged: analysis-3-1 gave symlink-escape its own 'blocked' outcome (distinct from derive-before-delete 'aborted'); analysis-4-2 consolidated scan+narrow into shared checkEscapingSymlinks.

IMPLEMENTATION: Implemented (converged final state). src/nuke-reinstall-pipeline.ts + src/clone-reinstall.ts.
- nuke-reinstall-pipeline.ts:6 imports checkEscapingSymlinks (analysis-4-2 wrapper owns narrowing). :15-32 NukeReinstallOptions carries cloneRoot w/ boundary doc. :74-84 NukeReinstallBlocked outcome (analysis-3-1).
- :103-109 checkEscapingSymlinks(sourceDir, cloneRoot) runs FIRST in executeNukeAndReinstall, before config/agents/dispatch and crucially before either replay's nukeManifestFiles; !ok → {status:"blocked", reason}.
- clone-reinstall.ts:394-402 PipelineInput carries cloneRoot; runPipeline 404-426 forwards; 454-459 maps pipeline blocked → clone-reinstall blocked (no failureReason → handleCopyFailedRemoval never matches).
- :308-321 local-path passes cloneRoot: options.sourceDir; :352-364 clone mode cloneRoot: tempDir while sourceDir = getSourceDirFromKey(tempDir,key) (member subdir scanned vs clone root).
- :241-251 CloneReinstallBlocked + union; :140-149 isCloneReinstallFailure + :151-172 mapCloneFailure route blocked via onBlocked on status alone (off copy-failed removal path). :282-287 buildCopySafetyMessage (distinct from buildAbortMessage, no remove+add).
- Consumers: update.ts:234-242 single-key ExitSignal(1) + buildCopySafetyMessage; :592-594 + 616-628 hasFailedOutcome includes blocked → all/multi non-zero.
- handleCopyFailedRemoval (377-392) only fires status==="failed" && failureReason==="copy-failed"; blocked carries neither → entry never removed by type design. assertSubpathWithinClone never called on update path.

TESTS: Adequate. boundary threading: clone-mode scans tempDir (clone-reinstall.test.ts:812); member subdir vs clone root (838); local-path scans (key,key) (866); unit boundary differs from member subdir (nuke-reinstall-pipeline.test.ts:665). Ordering scan before nuke+copy (687). Block-before-removal no nuke/copy (710; 891,1037). Entry not removed removeEntry/writeManifest not called (922). Named via seam onBlocked reason names link (950; mapCloneFailure/isCloneReinstallFailure/failureMessage blocked arms 1127,1185,1288). Within-clone cross-member allowed clean→success (753). No traversal guard assertSubpathWithinClone not called (741; 987). Clean tree updates normally (1009). Distinct message buildCopySafetyMessage no remove+add (1296). Mock mirrors real wrapper. Every AC covered.

CODE QUALITY: Conventions followed (discriminated unions, exhaustive mapCloneFailure, node: imports, status-as-discriminator like aborted precedent). SOLID good (blocked = clean open/closed extension; pre-flight guard clause at top, SRP intact). Complexity low. Modern idioms. Readability good (doc comments state install-intact/not-copy-failed/no-remove+add + rationale for no traversal guard).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] tests/nuke-reinstall-pipeline.test.ts:28-50 & tests/clone-reinstall.test.ts:60-82 — the copy-safety.js mock re-implements checkEscapingSymlinks scan-and-narrow inline in both files; consider extracting a shared test helper so the mirror of the real wrapper lives in one place and can't drift from src/copy-safety.ts.
