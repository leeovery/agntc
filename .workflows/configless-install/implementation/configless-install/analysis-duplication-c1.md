AGENT: duplication
CYCLE: 1
STATUS: findings
FINDINGS_COUNT: 6

FINDINGS:

**1. Duplicate filesystem-existence helper (`exists` vs `pathExists`) — SEVERITY: medium**
FILES: src/type-detection.ts:109-116, src/fs-utils.ts:26-34
type-detection.ts defines a private `exists(path)` byte-for-byte identical to `pathExists(path)` in fs-utils.ts (`try { await access(path); return true } catch { return false }`). fs-utils.ts is already the home for this primitive (nuke-reinstall-pipeline.ts imports `pathExists`). Two names for one concept across files invites drift.
RECOMMENDATION: Delete local `exists` in type-detection.ts; import `pathExists` from fs-utils.js. Call sites in classifyStructure/qualifiesAsMember are drop-in.

**2. Asset-dir presence scan repeated three times — SEVERITY: medium**
FILES: src/type-detection.ts:122-127, :198-203, src/nuke-reinstall-pipeline.ts:204-209
The loop "for (const dir of ASSET_DIRS) { if (await exists(join(root, dir))) collect/return }" is independently written three times (classifyStructure builds foundAssetDirs; qualifiesAsMember early-return any-match; replayRecordedPlugin builds presentAssetDirs — the last uses pathExists, the first two use local exists). Cross-task copy-paste drift hiding behavioural divergence.
RECOMMENDATION: Extract shared `findPresentAssetDirs(root): Promise<AssetType[]>` into type-detection.ts (derive qualifiesAsMember's boolean from `.length > 0`); reuse from replayRecordedPlugin.

**3. Local-path-validation + clone-and-reinstall + failure-mapping flow duplicated across update entry points — SEVERITY: high**
FILES: src/commands/update.ts:218-290, :300-395, src/commands/list-update-action.ts:24-78, src/commands/list-change-version-action.ts:84-114
Four call sites independently reimplement the reinstall sequence: (1) isLocal = entry.commit === null, (2) validate local source path when local, (3) call cloneAndReinstall with a near-identical options object, (4) branch on result.status failed/aborted and assemble a message. The isLocal / validateLocalSourcePath / `{ ...(isLocal ? { sourceDir: key } : {}) }` triple is verbatim in all four; failure branches diverge only in presentation. Highest-drift surface.
RECOMMENDATION: clone-reinstall.ts already owns buildFailureMessage/buildAbortMessage/mapCloneFailure. Lift isLocal detection + local-path validation + options assembly into a single helper there (e.g. prepareReinstall(key, entry, projectDir, opts)) so all four callers feed the same shaped input and only supply presentation handlers via mapCloneFailure.

**4. Abort message hand-rolled instead of reusing `buildAbortMessage` — SEVERITY: medium**
FILES: src/clone-reinstall.ts:107-117, src/commands/list-update-action.ts:58-65, src/commands/list-change-version-action.ts:97-104
clone-reinstall.ts exports buildAbortMessage(key, recordedType, reason) as the canonical derive-before-delete abort report (used by update.ts). The two list actions each construct an ad-hoc abort string, discarding recordedType and the remove+add remedy. Three near-duplicate abort phrasings that must stay in sync but already diverge.
RECOMMENDATION: Route both list actions' aborted branch through mapCloneFailure + buildAbortMessage (as update.ts does).

**5. ManifestEntry construction with conditional-constraint spread duplicated — SEVERITY: medium**
FILES: src/commands/add.ts:356-365, :703-712, src/nuke-reinstall-pipeline.ts:270-281
The entry literal `{ ref, commit, installedAt: new Date().toISOString(), agents, files, type, cloneUrl, ...(constraint != null && { constraint }) }` is assembled three times across two files. A shape change must be hand-synced in three places.
RECOMMENDATION: Extract a buildManifestEntry(fields) factory in manifest.ts owning the installedAt stamp and conditional constraint/cloneUrl spreads; call from all three sites.

**6. Copy-safety error catch-and-map block repeated — SEVERITY: low**
FILES: src/commands/add.ts:271-286, :552-572
The pre-flight guard pattern (assertSubpathWithinClone + scanForEscapingSymlinks inside try, then instanceof PathTraversalError/SymlinkEscapeError discrimination + rethrow) appears twice in add.ts, differing only in violation presentation (cancel+ExitSignal vs push failed result).
RECOMMENDATION: Extract runCopySafetyPreflight({ cloneRoot, unitDir, subpath }) in copy-safety.ts that runs both guards and returns a typed violation result (or rethrows non-guard errors), letting each caller map the violation to its own presentation.

SUMMARY: Six duplication patterns; most significant is the reinstall flow (local-path validation + cloneAndReinstall + failure mapping) independently re-authored across four command entry points, plus abort-message wording hand-rolled in the list actions instead of reusing clone-reinstall.ts's canonical helpers. Smaller cross-file repeats: duplicate fs-existence helper, thrice-written asset-dir scan, thrice-built manifest-entry literal.
