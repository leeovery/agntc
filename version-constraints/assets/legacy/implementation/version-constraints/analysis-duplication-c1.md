AGENT: duplication
FINDINGS:
- FINDING: ConstrainedUpdateOverrides interface duplicated across update.ts and list-update-action.ts
  SEVERITY: medium
  FILES: src/commands/update.ts:194-197, src/commands/list-update-action.ts:7-10
  DESCRIPTION: Two identical interfaces define the same shape { newRef: string; newCommit: string }. ConstrainedUpdateOverrides in update.ts and UpdateActionOverrides in list-update-action.ts are structurally equivalent and serve the same purpose — overriding the ref/commit during a constrained update. The list.ts command also constructs this same shape inline at line 161-162 when passing to executeUpdateAction.
  RECOMMENDATION: Define a single exported interface (e.g. VersionOverrides) in a shared location — either version-resolve.ts or a types module — and import it in both update.ts and list-update-action.ts. The list.ts inline construction can then be typed against the shared interface. This removes two independently-defined copies that must stay in sync.

- FINDING: mockExecFile helper duplicated in update-check.test.ts despite shared helper existing
  SEVERITY: medium
  FILES: tests/update-check.test.ts:11-34, tests/helpers/git-mocks.ts:4-28
  DESCRIPTION: update-check.test.ts defines a local mockExecFile function that is nearly identical to the shared mockExecFile in tests/helpers/git-mocks.ts. Both wrap vi.mocked(childProcess.execFile).mockImplementation with the same argument-shifting logic for the optional opts/cb parameters. The shared helper was extracted (likely during a previous remediation cycle) but update-check.test.ts was not migrated to use it. The local copy also defines mockLsRemoteSuccess and mockLsRemoteFailure convenience wrappers that could be added to the shared helper.
  RECOMMENDATION: Remove the local mockExecFile from update-check.test.ts and import the shared one from tests/helpers/git-mocks.ts. Move mockLsRemoteSuccess/mockLsRemoteFailure to git-mocks.ts if they are useful to other test files, or keep them local but built on top of the shared mockExecFile.

- FINDING: ManifestEntry construction with conditional constraint spread repeated three times
  SEVERITY: low
  FILES: src/commands/add.ts:299-307, src/commands/add.ts:589-597, src/nuke-reinstall-pipeline.ts:135-145
  DESCRIPTION: Three call sites construct ManifestEntry objects with the same structural pattern: base fields (ref, commit, installedAt, agents, files, cloneUrl) plus a conditional spread for the optional constraint field. The pattern `...(constraint != null && { constraint })` appears in all three. Each site sources its values from different contexts (add pipeline, collection pipeline, nuke-reinstall pipeline), so the inputs vary, but the construction shape is identical.
  RECOMMENDATION: This is borderline — the three sites have sufficiently different input sources that a factory function would need many parameters. Worth monitoring but not urgent to extract unless a fourth instance appears. If extracted, a buildManifestEntry helper in manifest.ts accepting typed input would consolidate the conditional constraint logic.

- FINDING: vi.mock() boilerplate blocks near-identical across four test files
  SEVERITY: low
  FILES: tests/commands/list-change-version-action.test.ts:6-63, tests/commands/list-update-action.test.ts:6-61, tests/clone-reinstall.test.ts:6-53, tests/commands/update.test.ts:13-74
  DESCRIPTION: Four test files declare near-identical vi.mock() blocks for the same set of modules: @clack/prompts, manifest.js, git-clone.js, config.js, type-detection.js, nuke-files.js, copy-plugin-assets.js, copy-bare-skill.js, drivers/registry.js. Each file independently specifies the mock shape (e.g. cloneSource: vi.fn(), cleanupTempDir: vi.fn()) with the same return values. The mock variable declarations (mockCloneSource, mockReadConfig, etc.) are also duplicated.
  RECOMMENDATION: This is a common test infrastructure concern. Extracting a shared setupMocks() helper in tests/helpers/ that registers the common mocks and returns typed mock references would reduce ~50 lines of boilerplate per file. However, vitest mock hoisting semantics make this nontrivial — vi.mock() calls must be at the top level. A more pragmatic approach is a shared mock-declarations module that each test re-exports, accepting that some repetition is inherent to vitest's design.

SUMMARY: The most actionable finding is the duplicated ConstrainedUpdateOverrides/UpdateActionOverrides interface across update.ts and list-update-action.ts, which represents the same concept implemented independently by separate task executors. The mockExecFile duplication in update-check.test.ts is a leftover from a previous extraction that missed one consumer. The ManifestEntry construction and test mock boilerplate are lower-severity patterns worth monitoring.
