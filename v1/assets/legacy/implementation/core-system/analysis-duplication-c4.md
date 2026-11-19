AGENT: duplication
FINDINGS:
- FINDING: Copy-failed manifest removal duplicated before mapCloneFailure at every call site
  SEVERITY: medium
  FILES: src/commands/update.ts:131-133, src/commands/list-update-action.ts:39-41, src/commands/list-update-action.ts:106-108, src/commands/list-change-version-action.ts:54-56
  DESCRIPTION: Every consumer of cloneAndReinstall checks `result.failureReason === "copy-failed"` and then calls `writeManifest(projectDir, removeEntry(manifest, key))` before dispatching through mapCloneFailure. This 3-line block is repeated 4 times across 3 files. In update.ts it is extracted to a local helper `handleCopyFailedRemoval` but the other two files inline it. The copy-failed manifest removal is a pipeline-level concern that leaks into every call site.
  RECOMMENDATION: Move the copy-failed manifest removal into cloneAndReinstall itself (it already has access to key and projectDir), or add an `onCopyFailed` lifecycle hook in CloneAndReinstallOptions that runs before returning the failed result. This would eliminate the check from all 4 call sites.

- FINDING: mapCloneFailure handler blocks nearly identical between runRemoteUpdate and runLocalUpdate in list-update-action.ts
  SEVERITY: medium
  FILES: src/commands/list-update-action.ts:43-68, src/commands/list-update-action.ts:110-135
  DESCRIPTION: Both runRemoteUpdate and runLocalUpdate in list-update-action.ts call mapCloneFailure with structurally identical handlers. All 6 handlers return `{ success: false, message: string }`. The only differences are in 2 of the 6 message strings (onNoConfig and onInvalidType use "New version of" vs bare key). The remaining 4 handlers (onNoAgents, onCopyFailed, onCloneFailed, onUnknown) are character-for-character identical. This is ~25 lines duplicated within the same file.
  RECOMMENDATION: Extract a local helper like `buildUpdateFailureResult(result, key, isLocal)` that returns the `{ success: false, message }` shape. The two message-string variations can be driven by the isLocal flag. Reduces ~50 lines to ~25.

- FINDING: Collision check + unmanaged check pipeline duplicated within add.ts
  SEVERITY: medium
  FILES: src/commands/add.ts:151-187, src/commands/add.ts:428-470
  DESCRIPTION: The standalone add path (lines 151-187) and the collection per-plugin loop (lines 428-470) both implement the same sequence: computeIncomingFiles -> checkFileCollisions -> resolveCollisions (with manifest update) -> checkUnmanagedConflicts -> resolveUnmanagedConflicts (with skip handling). The collection version wraps the cancel path in a `continue` instead of a `throw`, but the core 6-step structure is identical. Each is ~35 lines.
  RECOMMENDATION: Extract a shared function like `runConflictChecks({ incomingFiles, manifest, pluginKey, projectDir })` that returns `{ updatedManifest, proceed: boolean }`. The standalone path throws on !proceed, the collection path continues. This consolidates the conflict pipeline into one place.

- FINDING: Command action ExitSignal catch boilerplate repeated in all 4 commands
  SEVERITY: low
  FILES: src/commands/add.ts:558-567, src/commands/remove.ts:161-170, src/commands/update.ts:461-470, src/commands/list.ts:151-160
  DESCRIPTION: All four commands wrap their action handler in an identical try/catch that checks for ExitSignal and calls process.exit. The block is 7 lines, repeated 4 times with no variation.
  RECOMMENDATION: Extract a `withExitSignal(fn)` wrapper that returns an async function handling the ExitSignal pattern. Each command action becomes `.action(withExitSignal(async (source) => runAdd(source)))`. Place in exit-signal.ts alongside the class definition.

- FINDING: Build agent+driver pairs expression repeated 3 times
  SEVERITY: low
  FILES: src/commands/add.ts:132-135, src/commands/add.ts:370-373, src/nuke-reinstall-pipeline.ts:100-103
  DESCRIPTION: The expression `agents.map((id) => ({ id, driver: getDriver(id) }))` appears 3 times. Each maps an AgentId array to AgentWithDriver[]. The expression is only 3 lines but represents a conceptual operation (resolve agent IDs to driver instances) that belongs with the driver registry.
  RECOMMENDATION: Add a `buildAgentDriverPairs(ids: AgentId[]): AgentWithDriver[]` function to drivers/registry.ts. Replace the 3 inline map calls.

SUMMARY: The highest-impact new duplication is the copy-failed manifest removal pattern leaked into every cloneAndReinstall consumer (4 sites), the near-identical mapCloneFailure handler blocks within list-update-action.ts (2 sites, ~50 lines), and the conflict-check pipeline duplicated within add.ts between standalone and collection paths (~70 lines). Previous cycle extractions (cloneAndReinstall, mapCloneFailure, errorMessage, etc.) successfully consolidated the dominant patterns; what remains are second-order duplications that emerged as side effects of the refactoring.
