AGENT: duplication
CYCLE: 3
STATUS: findings
FINDINGS_COUNT: 2

FINDINGS:

- FINDING: List update/change-version actions duplicate the reinstall-result handling block
  SEVERITY: medium
  FILES: src/commands/list-update-action.ts:38-77, src/commands/list-change-version-action.ts:90-127
  DESCRIPTION: Both files implement the same tail of the reinstall flow: prepareReinstall (same not-ok message "Path ${key} does not exist or is not a directory"), cloneAndReinstall, isCloneReinstallFailure + mapCloneFailure with a handler object mapping every failure case to the action's result type, then addEntry + writeManifest on success. The two mapCloneFailure handler objects are structurally identical: onCloneFailed/onNoAgents/onCopyFailed/onUnknown each return { <flag>: false, message: msg } and onAborted returns { <flag>: false, message: buildAbortMessage(key, recordedType, reason) }. The only differences are the result discriminator key (success vs changed) and the success-path post-processing (change-version additionally calls stripConstraint). Independently-authored copy-paste across two task boundaries — drift risk on any abort/failure presentation change or a new CloneReinstallFailure variant.
  RECOMMENDATION: Extract a shared helper in clone-reinstall.ts (beside mapCloneFailure) that collapses any CloneReinstallFailure to a single { ok: false; message: string } ("all failures become one message"). Each list action wraps that message in its own { success/changed: false, message } result, keeping only its distinct success-path logic (constraint strip) local. update.ts's processUpdateForAll, which needs richer per-status outcomes, keeps its own handler.

- FINDING: SymlinkEscapeError pre-flight scan + catch block repeated across install/reinstall paths
  SEVERITY: low
  FILES: src/commands/add.ts:313-321, src/commands/add.ts:593-607, src/nuke-reinstall-pipeline.ts:84-95
  DESCRIPTION: The same pre-flight shape — try { await scanForEscapingSymlinks(dir, cloneRoot) } catch (err) { if (err instanceof SymlinkEscapeError) { <map violation> } throw err } — appears three times. The detect-then-rethrow-unknown skeleton is identical; only the violation mapping differs (add standalone → identity-prefixed p.cancel + ExitSignal(1); add collection member → push failed + continue; pipeline → return status:"aborted"). Borderline under Rule of Three.
  RECOMMENDATION: Optionally extract a helper in copy-safety.ts that runs the scan and returns { ok: true } | { ok: false; message: string } instead of throwing, letting each site map the message to its own channel. Lower priority; worth doing only if a fourth scan site appears.

SUMMARY: Reinstall machinery is already well-consolidated (prepareReinstall, mapCloneFailure, buildAbortMessage, copyUnit, findPresentAssetDirs, buildManifestEntry). The notable item is the near-identical failure-mapping tail duplicated between the two list action files; the symlink pre-flight try/catch repeated three times is minor/optional.
