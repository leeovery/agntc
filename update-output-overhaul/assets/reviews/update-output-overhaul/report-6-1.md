TASK: update-output-overhaul-6-1 — Single-source the sourceSubpath containment guard across the singleton and grouped clone paths

ACCEPTANCE CRITERIA:
- The guard + resolveUpdateSourceDir sequence (incl. PathTraversalError-vs-rethrow discrimination) exists in exactly one location.
- Both cloneAndReinstall's remote branch and reinstallMember obtain their guarded sourceDir via that single helper.
- A recorded sourceSubpath that lexically escapes the clone (e.g. ../evil) is still rejected pre-flight on BOTH the singleton and grouped paths, mapping to clone-failed with no nuke, no copy, install intact.
- Each call site retains only its own one-line failure mapping (raw clone-failed result vs mapReinstallResultToOutcome).
- Typecheck clean; full suite passes.

STATUS: Complete

SPEC CONTEXT:
The spec (Clone ownership seam — orchestrator; Copy-safety boundary — unchanged) mandates the per-member lexical sourceSubpath containment guard (assertSubpathWithinClone) run per member with cloneRoot = whole clone (tempDir): within-clone cross-member symlinks allowed, escapes beyond the clone rejected. It is explicitly a "preservation constraint, not a design choice" — dropping it is a path-traversal regression. Cycle 2 analysis found the guard+resolve sequence authored twice (singleton cloneAndReinstall and grouped reinstallMember), with only comments binding them; this task single-sources it so a future guard tweak provably reaches both entry points.

IMPLEMENTATION:
- Status: Implemented (matches the preferred narrow boundary from the task's "Do" step 1).
- Location:
  - Shared helper: src/source-parser.ts:514-534 (resolveGuardedSourceDir) — co-located with resolveUpdateSourceDir (483-491), imports assertSubpathWithinClone + PathTraversalError from copy-safety.js.
  - Singleton call site: src/clone-reinstall.ts:386-394 — maps !guarded.ok to the raw { status:"failed", failureReason:"clone-failed", message } it already returned; cloneRoot=tempDir preserved (405).
  - Grouped call site: src/update-groups.ts:327-339 (reinstallMember) — maps !guarded.ok through mapReinstallResultToOutcome(key, entry, {clone-failed…}, displayRef) exactly as before; cloneRoot=tempDir preserved (346).
- Notes:
  - Guard sequence now lives in exactly ONE location. grep confirms assertSubpathWithinClone is called only from source-parser.ts:521 (the update path) and commands/add.ts:295 (the separate add-command pre-flight, correctly untouched). clone-reinstall.ts and update-groups.ts no longer call it directly; both import resolveGuardedSourceDir.
  - Rethrow discrimination is correct: a PathTraversalError narrows to { ok:false, message: err.message } (verbatim); any other error rethrows unchanged (never swallowed as a failure result) — source-parser.ts:520-528.
  - No-op-when-absent behaviour preserved: the try/catch is gated on `if (sourceSubpath)`, and on success returns resolveUpdateSourceDir(...) (the key-derived fallback for absent subpath). Matches today's behaviour.
  - Each call site retains only its one-line failure mapping (raw clone-failed vs mapReinstallResultToOutcome); the grouped clone-failed arm routes through failedOutcome (update-groups.ts:189), giving the `<key>: Failed — <message>` summary the regression test asserts.
  - No circular import introduced (copy-safety.js imports only node builtins).
  - Minor briefing drift (not an implementation issue): the orchestrator's message listed src/commands/update.ts as a primary file, but the grouped path lives in src/update-groups.ts — the task's own description (task-6-1.txt) correctly cited update-groups.ts:290-310, and the implementation targeted it correctly.

TESTS:
- Status: Adequate
- Coverage:
  - Helper unit tests (REAL guard) — tests/source-parser.test.ts:1172-1211: contained subpath → ok:true resolved dir; absent subpath → ok:true key-derived dir (guard no-op); ../evil → ok:false with containment message.
  - Discrimination unit tests (MOCKED guard) — tests/clone-reinstall.test.ts:1252-1283: PathTraversalError → ok:false verbatim message; non-PathTraversalError ("disk exploded") RETHROWS. The rethrow branch is only reachable with a mock, so this coverage is necessary and not redundant with the real-guard tests.
  - Singleton integration — tests/clone-reinstall.test.ts:1086-1195: escaping sourceSubpath rejected pre-flight (clone-failed, message contains ../evil + "outside the clone root"); readConfig/scanForEscapingSymlinks/nukeManifestFiles/copyBareSkill/copyPluginAssets all asserted NOT called (no source read, no nuke, no copy); entry NOT removed (removeEntry/writeManifest not called — install intact); contained skills/<name> subpath passes and reinstalls.
  - Cross-path regression (REAL guard) — tests/shared-containment-guard.test.ts (whole file): the singleton path (cloneAndReinstall) and grouped path (processGroupUpdate/reinstallMember) reject the SAME ../evil subpath through the one shared helper; a third test asserts both surface the identical containment message. This is precisely the "one-sided divergence would fail" regression the acceptance criteria require. Deliberately does NOT mock copy-safety, so the real assertSubpathWithinClone runs at both sites.
- Notes:
  - Balanced — not under-tested (both entry points, both discrimination branches, no-op fallback, install-intact side-effects, and the cross-path regression are all covered) and not over-tested. The apparent overlap between the source-parser real-guard ok:false test and the clone-reinstall mocked-guard ok:false test is justified: they run in different mock contexts, and the clone-reinstall one is paired with the (mock-only) rethrow test to document both discrimination branches together.
  - Tests assert behaviour (failed/clone-failed status, verbatim message, absence of nuke/copy/remove side-effects, both-paths parity), not internal wiring.

CODE QUALITY:
- Project conventions: Followed. TypeScript discriminated result object ({ ok:true; sourceDir } | { ok:false; message }) consistent with the codebase's checkEscapingSymlinks pattern (copy-safety.ts:115) and the ...ok/reason result idiom used throughout. JSDoc explains the security invariant and the single-home rationale.
- SOLID principles: Good. Single responsibility (guard + resolve, one concern); the shared helper is the single point of change for the escape rule / error mapping. DRY without over-abstraction — collapses a genuine duplicate.
- Complexity: Low. One conditional guard + try/catch with a two-way instanceof discrimination.
- Modern idioms: Yes. Result-object over throwing across the call boundary; verbatim error message forwarding; correct instanceof narrowing with rethrow.
- Readability: Good. Co-located with resolveUpdateSourceDir (its natural home); both call sites carry updated comments pointing at the single source; the mirrored-comment coupling the analysis flagged is gone.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
