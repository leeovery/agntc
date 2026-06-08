AGENT: architecture
CYCLE: 11
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:
- FINDING: Cycle-9 source-dir resolution rule is re-authored in test code instead of being a shared, tested seam
  SEVERITY: medium
  FILES: src/clone-reinstall.ts:373-390, tests/integration/workflows.test.ts:764-766, tests/integration/workflows.test.ts:858-861
  DESCRIPTION: The "where do I re-copy a member's source from on update" decision — `entry.sourceSubpath ? join(cloneRoot, entry.sourceSubpath) : getSourceDirFromKey(cloneRoot, key)` — lives inline in `cloneAndReinstall` (clone-reinstall.ts:388) and is reached in production only after a real clone. The two integration tests that claim to cover it (workflows.test.ts cases (f) and (g)) do not call `cloneAndReinstall`; they hand-copy the same expression into the test body ("Resolve the source dir EXACTLY as cloneAndReinstall:352 does") and feed the result into `executeNukeAndReinstall`. The line-number comment is already stale (the code is now at :388, not :352) — the tell that the test is pinned to a duplicated literal rather than the function. NOTE (orchestrator): the production resolver branch IS directly exercised by clone-reinstall.test.ts (c10 added cloneAndReinstall-level tests for the `../evil` reject and the valid `skills/<name>` success), so the severity here is test-quality (re-authoring + stale comment), not an untested production seam.
  RECOMMENDATION: Extract the resolution into a small pure function (e.g. `resolveUpdateSourceDir(cloneRoot, key, entry.sourceSubpath)`), have `cloneAndReinstall` call it, and have integration cases (f)/(g) call the same function instead of re-deriving the expression. The path-traversal pre-check can move behind the same function so the guard and the join are validated together. Fix the stale `:352` comment.

- FINDING: Update-path orchestrators are exercised only via collaborator-mocked unit tests; no integration test drives runAdd / runCollectionPipeline / cloneAndReinstall end-to-end
  SEVERITY: medium
  FILES: tests/commands/add.test.ts:18-157, tests/integration/workflows.test.ts:88-1215, src/commands/add.ts:218-819, src/clone-reinstall.ts:306-415
  DESCRIPTION: The orchestration functions `runAdd`, `runCollectionPipeline`, `cloneAndReinstall` are only tested with every collaborator mocked. The integration suite never calls these orchestrators: each case manually re-stitches the sequence (detectType → copy* → build entry literal → writeManifest) using real lower-level units. So the actual wiring inside the orchestrators (step ordering, unitDir vs cloneRoot, per-member memberKey/memberSourceSubpath loop, partial-failure exit code) is verified only against mocks encoding the expected wiring, not real collaborators.
  RECOMMENDATION: Add a thin integration layer driving `runAdd` (local-path mode, no network) and `cloneAndReinstall` (sourceDir local-path mode) against real config/detection/copy/manifest on a temp dir. NOTE (orchestrator): this is a test-STRATEGY change, not a defect; the project's established approach is command-level mocked unit tests + unit-level integration tests. Treated as below the action bar / out of scope for this work unit.

- FINDING: Clone-URL fallback derivation is implemented twice across two source-parser exports
  SEVERITY: low
  FILES: src/source-parser.ts:391-421, src/source-parser.ts:430-441
  DESCRIPTION: `buildParsedSourceFromKey` and `deriveCloneUrlFromKey` both independently reconstruct the GitHub fallback clone URL from a manifest key when cloneUrl is null. KNOWN RECURRENCE (c10 architecture LOW). Below-threshold.
  RECOMMENDATION: Have `buildParsedSourceFromKey` call `deriveCloneUrlFromKey(key, cloneUrl)` for its cloneUrl field.

SUMMARY: Module boundaries, discriminated-result seams, and type-narrowing are clean and well-scoped. The findings are test-side: the cycle-9 source-dir resolution is re-authored in integration test bodies (though the production seam IS unit-tested via clone-reinstall.test.ts) with a stale comment; the install/update orchestrators are tested only against mocks (a test-strategy observation, established project approach); and a low known-recurrence clone-URL fallback duplication.
