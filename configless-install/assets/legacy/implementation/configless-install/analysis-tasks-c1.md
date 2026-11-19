# Analysis Cycle 1 — Proposed Tasks

11 raw findings deduplicated into 6 tasks. Two low-severity standalone findings discarded (Dup #6 copy-safety catch block; Standards dead ConfigError class).

---

## Task 1: Consolidate the clone-and-reinstall flow across the four update entry points
status: approved
severity: high
sources: duplication

**Problem**: Four call sites independently reimplement the reinstall sequence — src/commands/update.ts:218-290, :300-395, src/commands/list-update-action.ts:24-78, src/commands/list-change-version-action.ts:84-114. Each repeats: isLocal = entry.commit === null, local-path validation when local, a near-identical cloneAndReinstall options object with the `{ ...(isLocal ? { sourceDir: key } : {}) }` spread, and a failed/aborted branch assembling a message. The triple is verbatim in all four. The two list actions (list-update-action.ts:58-65, list-change-version-action.ts:97-104) hand-roll abort strings instead of reusing buildAbortMessage (clone-reinstall.ts:107-117), discarding recordedType and the remove+add remedy.

**Solution**: Lift isLocal detection + local-path validation + options assembly into prepareReinstall(key, entry, projectDir, opts) in src/clone-reinstall.ts; route both list actions' aborted branch through mapCloneFailure + buildAbortMessage as update.ts does.

**Outcome**: One shared preparation helper feeds all four entry points; abort/failure messages flow through the single canonical path.

**Do**: (1) Add prepareReinstall to clone-reinstall.ts. (2)-(3) Replace inline prep in the two update.ts blocks and both list actions with calls to it. (4) Replace hand-rolled abort strings in the list actions with mapCloneFailure + buildAbortMessage.

**Acceptance Criteria**: all four obtain input via prepareReinstall; both list actions render aborts via buildAbortMessage (incl. recordedType + remedy); observable behaviour unchanged.

**Tests**: unit-test prepareReinstall for local/remote entries; assert list-action abort output includes recordedType + remedy; regression-test all four flows unchanged.

---

## Task 2: Move the lexical path-traversal subpath check ahead of detection/config reads
status: approved
severity: medium
sources: architecture

**Problem**: For a direct-path source the subpath is joined into unitDir at step 2b (add.ts:187-205), then readConfig(unitDir) and detectType(unitDir) read the filesystem at that joined path before assertSubpathWithinClone runs at step 9b (add.ts:271-286; collection at :553-556). readdir/access/readFile execute on an attacker-controlled ..-escaped path before containment is validated.

**Solution**: Move assertSubpathWithinClone(sourceDir, parsed.type === "direct-path" ? parsed.targetPlugin : undefined) to immediately after unitDir is computed (after step 2b), before any read. Keep the symlink scan at 9b.

**Outcome**: an escaping subpath is rejected before any read at the joined path, for both single-plugin and collection direct-path flows.

**Do**: (1) Invoke the lexical guard right after step 2b. (2) Ensure the collection member loop relies on the earlier check. (3) Leave the symlink scan unchanged.

**Acceptance Criteria**: guard fires before readConfig/detectType; runs for both direct-path paths; symlink scan remains pre-copy; valid sources still install.

**Tests**: escaping single-plugin subpath rejected before reads; escaping collection member aborts before runCollectionPipeline reads configs; valid in-bounds subpath still installs.

---

## Task 3: Add integration coverage for the configless cross-task seams
status: approved
severity: medium
sources: architecture

**Problem**: tests/integration/workflows.test.ts:60-421 ships agntc.json in every scenario and covers only v1 flows. None of: configless detection -> manifest type write, type backfill round-trip, derive-before-delete abort, structural collection-membership scan, copy-safety pre-flight. The agent-drop test builds an entry with no type and exercises the ?? "skill" fallback rather than a backfilled value.

**Solution**: Add four real-driver, real-manifest-round-trip scenarios.

**Outcome**: the new seams are exercised end-to-end; backfill observed via real read-then-write, not the fallback.

**Do**: (1) configless bare-skill (no agntc.json) -> detect -> copy -> write -> read back asserting type:"skill". (2) legacy entry without type -> read backfill -> write persists derived type. (3) recorded-plugin reshaped to bare-skill -> executeNukeAndReinstall aborted, files intact. (4) escaping-symlink source -> pipeline aborts before nuke.

**Acceptance Criteria**: scenarios cover all four seams against real drivers; backfill scenario asserts persisted derived type; abort scenario asserts files intact.

**Tests**: the four scenarios are the tests.

---

## Task 4: De-duplicate the asset-dir presence scan
status: approved
severity: medium
sources: duplication

**Problem**: The `for (const dir of ASSET_DIRS) { if (await exists(join(root, dir))) ... }` loop is written three times — type-detection.ts:122-127 (foundAssetDirs), :198-203 (qualifiesAsMember), nuke-reinstall-pipeline.ts:204-209 (presentAssetDirs). First two use local exists, third uses pathExists.

**Solution**: Extract findPresentAssetDirs(root): Promise<AssetType[]> into type-detection.ts; derive qualifiesAsMember from .length > 0; reuse from replayRecordedPlugin.

**Outcome**: one scan function, one existence primitive across all three sites.

**Do**: add the helper; rewrite the three call sites to consume it.

**Acceptance Criteria**: scan loop in exactly one place; one primitive; detection/membership/replay unchanged.

**Tests**: unit-test findPresentAssetDirs for zero/one/many dirs; regression-test the three consumers.

---

## Task 5: De-duplicate the fs-existence helper and the ManifestEntry construction
status: approved
severity: medium
sources: duplication

**Problem**: (1) type-detection.ts:109-116 defines exists byte-identical to pathExists in fs-utils.ts:26-34. (2) The ManifestEntry literal `{ ref, commit, installedAt: new Date().toISOString(), agents, files, type, cloneUrl, ...(constraint != null && { constraint }) }` is built three times: add.ts:356-365, :703-712, nuke-reinstall-pipeline.ts:270-281.

**Solution**: Delete local exists, import pathExists; add buildManifestEntry(fields) in manifest.ts owning the installedAt stamp and conditional spreads; call from all three sites.

**Outcome**: one existence primitive; one entry factory.

**Do**: (1) remove exists, import pathExists, update call sites. (2) add buildManifestEntry. (3) replace the three literals.

**Acceptance Criteria**: no local exists; literal in one place; entries byte-identical in shape.

**Tests**: unit-test buildManifestEntry with/without constraint and cloneUrl; regression-test the three sites produce identical entries.

---

## Task 6: Simplify the clone-reinstall failure-status modelling
status: approved
severity: low
sources: standards, architecture

**Problem**: (1) CloneReinstallAborted carries both status:"aborted" and failureReason:"aborted" (clone-reinstall.ts:32-98; callers update.ts:34-49); mapCloneFailure dispatches on failureReason while callers branch on status. (2) runPipeline packages the lenient no-agents skip as status:"failed", failureReason:"no-agents" (nuke-reinstall-pipeline.ts:115-123, clone-reinstall.ts:258-264) though the spec frames it as a lenient skip. Both naming/shape mismatches, no behavioural drift.

**Solution**: Make status the single discriminator — drop failureReason:"aborted", dispatch aborted on status and failed variants on failureReason; surface no-agents under a non-failed status (keep mapCloneFailure.onNoAgents recovery).

**Outcome**: single aborted discriminator; no-agents not failed; observable behaviour unchanged.

**Do**: (1) remove failureReason:"aborted". (2) update mapCloneFailure dispatch. (3) surface no-agents non-failed in pipeline + clone-reinstall. (4) confirm caller branches resolve under status.

**Acceptance Criteria**: no failureReason:"aborted"; no-agents not status:"failed"; single-key returns null/exit 0 and all-updates emits non-fatal skip unchanged.

**Tests**: unit-test mapCloneFailure aborted (via status) and failed variants (via failureReason); regression-test no-agents single-key untouched/exit 0 and all-updates non-fatal skip.
