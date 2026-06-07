AGENT: architecture
CYCLE: 1
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:

- FINDING: Path-traversal guard runs after detection/config read on the unvalidated selector subpath
  SEVERITY: medium
  FILES: src/commands/add.ts:187-205, src/commands/add.ts:271-286, src/commands/add.ts:553-556
  DESCRIPTION: For a direct-path (tree URL) source the selector subpath is joined into unitDir = join(sourceDir, parsed.targetPlugin) at step 2b, then readConfig(unitDir) (step 3) and detectType(unitDir) (step 4) both read the filesystem at that joined path. The assertSubpathWithinClone guard does not run until step 9b — after detection, config reading, agent selection, and the collection-pipeline dispatch. The spec frames the path-traversal guard as a pre-flight scan that validates a selector's <subpath> resolves within the clone before any copy. Current ordering writes no files before the guard (no on-disk window), but it performs readdir/access/readFile on an attacker-controlled ..-escaped path before validating containment. A direct-path collection validates the subpath only at line 553-555 inside the per-member loop — again after runCollectionPipeline has read configs and re-run detectType against the escaped path.
  RECOMMENDATION: Move the lexical assertSubpathWithinClone(sourceDir, parsed.type === "direct-path" ? parsed.targetPlugin : undefined) up to immediately after unitDir is computed (right after step 2b), before any readConfig/detectType touches the joined path. The symlink scan can stay at 9b (content validation that must precede copy), but the cheap lexical subpath check should gate the first use of the subpath.

- FINDING: Integration suite covers only v1 flows, none of the configless seams
  SEVERITY: medium
  FILES: tests/integration/workflows.test.ts:60-421
  DESCRIPTION: The integration test is the only suite that composes multiple modules against the real drivers, but every scenario ships an agntc.json and exercises only v1-era flows (bare-skill copy, plugin collision, agent-drop via executeNukeAndReinstall, remove). None of this feature's cross-task seams are integration-tested: configless detection driving the manifest type write, the type backfill on manifest read (legacy entry -> derived type -> persisted on next write), the derive-before-delete abort path (recorded skill/plugin vs a reshaped source), the structural collection-membership scan replacing the agntc.json enumeration, and the copy-safety pre-flight gating a real copy. The agent-drop test builds its ManifestEntry with no type field and asserts success, silently exercising the ?? "skill" defensive fallback rather than a backfilled value.
  RECOMMENDATION: Add integration scenarios wiring the new seams against real drivers and a real manifest round-trip: (1) configless bare-skill source (no agntc.json) -> detect -> copy -> manifest write -> read back asserting type:"skill"; (2) legacy entry without type -> readManifest backfill -> writeManifest persists derived type; (3) recorded-plugin source reshaped to bare-skill -> executeNukeAndReinstall returns aborted with files intact; (4) source with an escaping symlink -> pipeline aborts before nuke.

- FINDING: Abort seam carries redundant dual discriminators
  SEVERITY: low
  FILES: src/clone-reinstall.ts:32-98, src/commands/update.ts:34-49
  DESCRIPTION: CloneReinstallAborted carries both status:"aborted" and failureReason:"aborted" (clone-reinstall.ts:88-93). mapCloneFailure dispatches on failureReason while every caller branches on status === "failed" || status === "aborted". The two tags encode the same fact, kept in sync by hand; status is the real discriminator everywhere except inside mapCloneFailure. Works, but a redundant-tag seam smell.
  RECOMMENDATION: Drop failureReason:"aborted" and have mapCloneFailure switch on result.status for the aborted arm and on result.failureReason only for the failed variants, making status the single discriminator across the boundary.

SUMMARY: Module structure, type modelling, and the override/replay seams are sound and well-documented; the substantive issues are an ordering gap where the path-traversal selector check fires after detection/config reads on the unvalidated subpath, and an integration suite that exercises only v1 flows and none of this feature's new cross-task seams.
