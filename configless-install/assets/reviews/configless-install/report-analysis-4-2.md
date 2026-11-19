TASK: configless-install-analysis-4-2 — Consolidate the symlink-escape scan + SymlinkEscapeError-narrow + rethrow (hand-authored 3×) into a single checkEscapingSymlinks helper in src/copy-safety.ts returning a discriminated {ok} result; three call sites drop instanceof narrowing, own only their distinct surfacing. Consolidation only.

ACCEPTANCE CRITERIA: single helper performs scan + narrowing, three call sites contain no instanceof SymlinkEscapeError; standalone violations → identity-prefixed cancel + ExitSignal(1), member → failed-result + continue (siblings unaffected), pipeline → blocked-status; non-SymlinkEscapeError errors propagate from all three; scan boundaries unchanged per site; full suite passes.

STATUS: Complete

SPEC CONTEXT: Symlink-escape guard (377-398) — pre-flight content-safety on every install (bare skills incl), rejects symlinks lexically resolving outside clone root (boundary = clone root not unit dir; within-clone cross-member links allowed; broken links lexical). Violations pre-flight (nothing written, non-zero, names unit). Consolidation must preserve all.

IMPLEMENTATION: Implemented (clean, no drift). Helper src/copy-safety.ts:115-128 (checkEscapingSymlinks). Call sites: standalone add.ts:353-357, collection-member add.ts:625-638, update replay nuke-reinstall-pipeline.ts:103-109.
- Helper wraps scanForEscapingSymlinks in try/catch: {ok:true} on success, {ok:false,message:err.message} for SymlinkEscapeError (verbatim), rethrow any other.
- Actual scan (copy-safety.ts:74-104) + boundary semantics untouched.
- Each site passes same scan target: standalone (unitDir, sourceDir) (353); member (pluginDir, cloneRoot) (625-628); pipeline (sourceDir, cloneRoot) (103). Distinct surfacing preserved verbatim: standalone p.cancel(`${manifestKey}: ${message}`) + ExitSignal(1); member push {pluginName,status:"failed",copiedFiles:[],agents:[],errorMessage} + continue; pipeline return {status:"blocked",reason:message}.
- Grep zero instanceof SymlinkEscapeError in production outside helper; three sites import only checkEscapingSymlinks. Non-SymlinkEscapeError propagation structurally guaranteed (single throw err only in helper).

TESTS: Adequate. Helper unit tests (tests/copy-safety.test.ts:259-305) all three branches w/ real fixtures: {ok:true}; {ok:false,message} verbatim; rethrows non-SymlinkEscapeError (ENOENT, not.toBeInstanceOf SymlinkEscapeError + toThrow). Standalone surfacing (add.test.ts:6407-6427) identity-prefixed cancel + ExitSignal 1 no nuke/copy/write. Member surfacing (6604-6651) pluginA fails pluginB installs, manifest written, deferred non-zero. Pipeline surfacing (nuke-reinstall-pipeline.test.ts:710-739) status blocked no nuke/copy reason names link. Scan boundaries explicitly asserted unchanged per site (6311/6360/6335/6594/6598; pipeline 681). Mock-mirrors-module pattern (each consumer mock re-implements checkEscapingSymlinks delegating to mocked scanForEscapingSymlinks). Read-verified.

CODE QUALITY: Conventions followed (discriminated union return matches result-type idiom NukeReinstallResult/AgentResolution; exhaustive JSDoc). SOLID good (single responsibility helper owns scan-and-narrow, callers own surfacing — removes open/closed friction of 3 divergent copies). Complexity low. Modern idioms (discriminated result over exception-for-control-flow at call sites; instanceof centralised once). Readability good (each site now 2-line intent; JSDoc documents verbatim-message + rethrow + boundary-unchanged).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None. (Per-test-file mock-wrapper duplication is inherent to module mocking — proposing to dedupe is speculative test-infra scope, not a clear win.)
