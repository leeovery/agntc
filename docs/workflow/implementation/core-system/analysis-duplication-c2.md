AGENT: duplication
FINDINGS:
- FINDING: NukeReinstallResult status handling duplicated across 5 call sites
  SEVERITY: high
  FILES: src/commands/update.ts:148-171, src/commands/update.ts:250-273, src/commands/update.ts:327-358, src/commands/list-update-action.ts:74-101, src/commands/list-change-version-action.ts:90-117
  DESCRIPTION: Every consumer of executeNukeAndReinstall duplicates the same 4-way if-chain handling no-config, no-agents, invalid-type, and copy-failed statuses. Each site constructs slightly different error messages but follows identical control flow. The pattern spans ~25 lines each time and appears in runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll (all in update.ts), runRemoteUpdate and runLocalUpdate (in list-update-action.ts), and executeChangeVersionAction (in list-change-version-action.ts).
  RECOMMENDATION: Extract a shared function like handleNukeReinstallFailure that maps non-success NukeReinstallResult statuses to a standard { success: false, message } shape. Each call site then only needs to check for the success case. Alternatively, the pipeline itself could throw typed errors for failure statuses, letting callers use a single catch. Place in a shared module like src/pipeline-result-handler.ts or integrate into nuke-reinstall-pipeline.ts as a companion function.

- FINDING: Clone-then-cleanup boilerplate repeated in 4 call sites
  SEVERITY: high
  FILES: src/commands/update.ts:113-201, src/commands/update.ts:300-386, src/commands/list-update-action.ts:38-122, src/commands/list-change-version-action.ts:53-138
  DESCRIPTION: Four independent implementations of the same pattern: (1) buildParsedSourceFromKey, (2) spinner start, (3) cloneSource with try/catch around spinner stop, (4) getSourceDirFromKey, (5) executeNukeAndReinstall with onAgentsDropped callback, (6) handle pipeline result statuses, (7) write manifest, (8) cleanupTempDir in finally block. Each is ~60-80 lines following the same structure with only the return-type wrapper varying (ManifestEntry | null vs PluginOutcome vs UpdateActionResult vs ChangeVersionResult).
  RECOMMENDATION: Extract a shared cloneAndReinstall function that encapsulates steps 1-6 and the finally cleanup. It would accept a key, entry, projectDir, optional newRef/newCommit, and return a discriminated union of success (with ManifestEntry + copiedFiles + droppedAgents) or failure (with message). Each command then only maps the shared result to its own return type. Place in src/clone-reinstall.ts or extend nuke-reinstall-pipeline.ts.

- FINDING: onAgentsDropped warning string duplicated verbatim 5 times
  SEVERITY: medium
  FILES: src/commands/update.ts:138-143, src/commands/update.ts:241-245, src/commands/update.ts:317-322, src/commands/list-update-action.ts:64-69, src/commands/list-change-version-action.ts:80-85
  DESCRIPTION: The exact same warning message template is constructed independently 5 times: "Plugin ${key} no longer declares support for ${dropped.join(", ")}. Currently installed for: ${entry.agents.join(", ")}. New version supports: ${newConfigAgents.join(", ")}." This is tightly coupled to the clone-then-cleanup duplication above — consolidating the parent pattern would also eliminate this.
  RECOMMENDATION: If the clone-then-cleanup pattern is extracted, this goes away automatically. Otherwise, extract a formatAgentsDroppedWarning(key, entry, dropped, newConfigAgents) helper in src/summary.ts.

- FINDING: readSourceAssetDir and readTopEntries are near-identical
  SEVERITY: medium
  FILES: src/compute-incoming-files.ts:88-95, src/copy-plugin-assets.ts:90-97
  DESCRIPTION: Both functions read a directory and map entries to {name, isDirectory} objects. readSourceAssetDir in compute-incoming-files.ts returns Promise<SourceEntry[]> and readTopEntries in copy-plugin-assets.ts returns Promise<DirEntry[]>. The interfaces SourceEntry and DirEntry are structurally identical ({name: string, isDirectory: boolean}). Both handle errors by returning an empty array.
  RECOMMENDATION: Extract a shared readDirEntries function into a common module (e.g., src/fs-utils.ts) with a single DirEntry interface. Both compute-incoming-files.ts and copy-plugin-assets.ts import from it.

- FINDING: deriveCloneUrl implemented independently in two files
  SEVERITY: medium
  FILES: src/commands/add.ts:33-40, src/update-check.ts:12-17
  DESCRIPTION: Two independent implementations that derive a clone URL from a key or parsed source. In add.ts it handles all ParsedSource variants; in update-check.ts it constructs https://github.com/{owner}/{repo}.git from a manifest key. Both encode the same GitHub shorthand-to-URL logic but diverge in signature and completeness (update-check.ts ignores cloneUrl from manifest entries, relying on its own derivation).
  RECOMMENDATION: Consolidate into a single function in src/source-parser.ts or src/git-utils.ts. The update-check.ts version already falls back to entry.cloneUrl at its call site (line 61), so the derivation function just needs to handle the fallback case.

- FINDING: Manifest entry removal uses manual loop instead of removeEntry in two places
  SEVERITY: low
  FILES: src/commands/remove.ts:145-150, src/commands/list-remove-action.ts:31-36
  DESCRIPTION: Both remove.ts and list-remove-action.ts manually iterate Object.entries to filter out a key, producing a new manifest object. The manifest module already exports removeEntry(manifest, key) that does exactly this. The manual loops are small (~5 lines) but represent unnecessary divergence from the shared utility.
  RECOMMENDATION: Replace the manual loops with removeEntry from src/manifest.ts. For remove.ts which handles multiple keys, a simple reduce or loop calling removeEntry would suffice.

- FINDING: Local path validation (stat + isDirectory) pattern repeated 3 times
  SEVERITY: low
  FILES: src/commands/update.ts:204-220, src/commands/update.ts:396-412, src/commands/list-update-action.ts:134-147
  DESCRIPTION: Three places perform the same check: call stat on a path, verify isDirectory(), produce an error message "Path X does not exist or is not a directory" on failure. The source-parser.ts also has similar logic in parseLocalPath. Each handles the error differently (ExitSignal vs return value) but the core validation is identical.
  RECOMMENDATION: Extract a validateLocalPath helper that returns a boolean or throws a typed error. Place in src/source-parser.ts alongside the existing local path logic, or in a new src/fs-utils.ts.

SUMMARY: The dominant duplication pattern is the clone-then-nuke-and-reinstall pipeline orchestration, which is repeated with minor variations across update.ts, list-update-action.ts, and list-change-version-action.ts. Extracting this into a shared function would eliminate the two highest-severity findings and the medium-severity agents-dropped warning duplication, removing roughly 200-250 lines of near-duplicate code. The readSourceAssetDir/readTopEntries and deriveCloneUrl duplications are smaller but straightforward to consolidate.
