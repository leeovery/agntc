TASK: 1.4 — Group orchestrator: clone once, reinstall members sequentially with isolation (update-output-overhaul-1-4)

ACCEPTANCE CRITERIA:
1. A group with N updating members calls cloneSource (via cloneRepoOnce) exactly once and returns N outcomes attributed to each member's key.
2. assertSubpathWithinClone(tempDir, sourceSubpath) runs once per member that carries a sourceSubpath; a member whose recorded subpath lexically escapes the clone becomes an isolated failure and does not nuke/copy (path-traversal preservation).
3. One member's thrown/rejected reinstall becomes that member's failed outcome; subsequent siblings still run.
4. cleanupTempDir(tempDir) is called exactly once, in a finally wrapping the whole loop, even when a member throws.
5. runPipeline (or its wrapper) is called with cloneRoot = tempDir and sourceDir = resolveUpdateSourceDir(tempDir, key, sourceSubpath) for each member (copy-safety boundary unchanged; member subpath scanned against the whole clone).

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Repo Clone Dedup → Clone ownership seam — orchestrator": the reinstall half (runPipeline) is already clone-agnostic, taking { sourceDir, cloneRoot } separately, so the orchestrator clones once and loops members through runPipeline with cloneRoot = sharedTempDir and sourceDir = resolveUpdateSourceDir(...), cleaning up once. Preserving the per-member lexical sourceSubpath containment guard (assertSubpathWithinClone) is an explicit preservation constraint, not a design choice — dropping it is a path-traversal regression. "Failure isolation & lifecycle": each member in its own try/catch; cleanupTempDir once in a finally wrapping the entire member loop; copy-safety boundary unchanged (cloneRoot = whole clone). Spec explicitly leaves the Result → PluginOutcome mapping factoring (shared helper vs inline) to the implementer — behaviourally invariant. Acceptance criterion 7.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-groups.ts:384-420 (processGroupUpdate), src/update-groups.ts:310-355 (reinstallMember), src/update-groups.ts:165-223 (mapReinstallResultToOutcome), src/update-groups.ts:276-297 (groupTargetFacets); src/clone-reinstall.ts:457 (runPipeline exported for reuse); src/source-parser.ts:514-534 (resolveGuardedSourceDir — shared guard+source-dir composition).
- Notes:
  - Clone-once: cloneRepoOnce called once via group.members[0]; the whole member loop wrapped in try/finally with cleanupTempDir in the finally (update-groups.ts:411-417). Each member isolated in its own try/catch inside reinstallMember (update-groups.ts:326-354).
  - Path-traversal guard preserved per member via resolveGuardedSourceDir (composes assertSubpathWithinClone against the whole clone root, then resolveUpdateSourceDir), the SAME helper the singleton cloneAndReinstall now uses (clone-reinstall.ts:386). A PathTraversalError maps to a clone-failed pre-flight → failed outcome, no nuke/no copy — identical to the singleton path. This is a cleaner factoring than the task's suggested inline assertSubpathWithinClone + resolveUpdateSourceDir, and is explicitly the implementer's call per spec.
  - runPipeline invoked with cloneRoot = tempDir (whole clone) and sourceDir = guarded.sourceDir (= resolveUpdateSourceDir) for every member (update-groups.ts:341-349); newRef = cloneRef ?? null and newCommit = commit, both projected from the single groupTargetFacets switch (constrained → tag/target.commit; branch/head → undefined/resolvedSha) — matches the task's effectiveRef/effectiveCommit rule exactly.
  - Clone-fatal fan-out (task 1-7) is co-located here: a cloneRepoOnce throw returns N failed outcomes over the updating subset (not group.members) with no cleanup — correct, since there is no tempDir. The GroupUpdateResult wrapper's cloneFailed flag is a display-only signal (task 2-6) and leaves the N-outcome model untouched.
  - Minor observation (no action): the clone's key/entry is taken from group.members[0] rather than the updating members[0]. Behaviourally identical — the grouping invariant guarantees every group member shares the derived cloneUrl and (for branch/HEAD) the same ref, and a constrained clone overrides ref with the resolved tag — so any member yields the same clone. Not a defect.

TESTS:
- Status: Adequate
- Coverage (tests/update-groups.test.ts, describe "processGroupUpdate", lines 678-1039):
  - AC1: "clones once for a 3-member group and reinstalls each member from the shared clone" — cloneSource called once, 3 outcomes keyed a/b/c, each reinstalled from its own subdir of the single clone; branch commit asserted to be the resolved sha, not the clone HEAD. Plus "clones a constrained group once at the resolved target tag" asserts the --branch override reaches cloneSource and target.commit is recorded per member.
  - AC2: "runs assertSubpathWithinClone per member and isolates a traversal-escaping subpath" — guard called 3× (once per member) against the whole clone root; the ../evil member becomes failed while siblings update; the escaping member is neither nuked nor copied (copyBareSkill called exactly twice).
  - AC3: "contains one member reinstall throw so later siblings still reinstall" — the throwing member (b) is failed; both a and the AFTER-sibling c still update.
  - AC4: "calls cleanupTempDir exactly once after the whole member loop, even when a member throws" — cleanup once with the clone dir. Also the clone-fatal test asserts cleanup is NOT called (no tempDir).
  - AC5: "scans each member subdir against the clone root (cloneRoot = whole clone), not the subdir" — scanForEscapingSymlinks called with (subdir, cloneRoot) per member.
  - Extra: clone-fatal fan-out to N failed outcomes; fan-out over the updating subset excluding up-to-date siblings.
- Notes: Mocks are correctly layered — assertSubpathWithinClone is mocked while resolveGuardedSourceDir (source-parser) stays real, so the guard COMPOSITION is genuinely exercised, not stubbed. Not over-tested: each test targets one acceptance facet. One small gap: no test asserts cleanupTempDir is called exactly once on the all-success path (only the throwing path and the clone-fatal skip are asserted); the finally is unconditional so success also cleans once, but the happy-path count is implicit.

CODE QUALITY:
- Project conventions: Followed. Conditional spread for the optional newRef (update-groups.ts:399) respects exactOptionalPropertyTypes; discriminated unions used throughout; JSDoc is thorough and load-bearing.
- SOLID principles: Good. reinstallMember (single member, isolated), processGroupUpdate (orchestration), groupTargetFacets (single target→facets projection), mapReinstallResultToOutcome (single Result→Outcome mapping), failedOutcome (single failed-literal constructor) are each single-responsibility and shared with the singleton path so wording/behaviour cannot drift.
- Complexity: Low. processGroupUpdate is a clean clone → loop → finally-cleanup shape; no nested branching beyond the target switch.
- Modern idioms: Yes. Conditional object spread, exhaustive-ish switch with documented default, non-null assertion on group.members[0] justified by the group invariant.
- Readability: Good. The guard/boundary reasoning is documented inline at every non-obvious point.
- Issues: None blocking.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [do-now] tests/update-groups.test.ts:734 — add `expect(mockCleanupTempDir).toHaveBeenCalledTimes(1)` to the all-success "clones once for a 3-member group" test so single-cleanup is asserted on the happy path, not only on the throwing path (the finally is unconditional, so it will pass).
- [idea] src/update-groups.ts:294-296 — groupTargetFacets' default arm returns `commit: ""` for tag / constrained-no-match / check-failed targets. It is provably unreachable for the orchestrator today (streamGroupWork only passes updatable constrained/branch/head groups), and documented as a benign no-op. Consider whether to harden it against a future caller (e.g. throw on an unexpected kind) so a mis-routed target surfaces loudly instead of silently recording an empty commit — a decide-whether call, not a current defect.
