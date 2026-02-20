AGENT: duplication
FINDINGS:
- FINDING: mapCloneFailure handler blocks nearly identical between list-update-action.ts and list-change-version-action.ts
  SEVERITY: medium
  FILES: src/commands/list-update-action.ts:49-79, src/commands/list-change-version-action.ts:54-80
  DESCRIPTION: Both files call mapCloneFailure with 6 handler callbacks that return a result-object with a boolean flag and message string. The handlers are structurally identical — the only differences are the field name (success vs changed) and 2 of the 6 message strings (onNoConfig and onInvalidType use "New version of" in the change-version variant). The remaining 4 handlers (onNoAgents, onCopyFailed, onCloneFailed, onUnknown) produce character-for-character identical messages. This is ~25 lines duplicated across the two files. C4 flagged a similar issue within list-update-action.ts (between runRemoteUpdate and runLocalUpdate), which was consolidated. The cross-file duplication between list-update-action.ts and list-change-version-action.ts is a separate finding that remains.
  RECOMMENDATION: Extract a shared helper that takes a CloneReinstallFailed result and a key, and returns a standard { message: string } object. Each call site wraps it in its own return type ({ success: false, ...msg } vs { changed: false, ...msg }). Something like buildFailureMessage(result, key, { isLocal?: boolean }) in clone-reinstall.ts. Each call site reduces to 2-3 lines.

- FINDING: formatRef in list-detail.ts duplicates formatRefLabel in summary.ts
  SEVERITY: low
  FILES: src/commands/list-detail.ts:13-17, src/summary.ts:13-19
  DESCRIPTION: list-detail.ts defines formatRef(entry: ManifestEntry) and summary.ts exports formatRefLabel(ref, commit). Both implement the same logic: if ref is non-null return it, if there is a commit return "HEAD", otherwise return "local". The only difference is the function signature — one takes a ManifestEntry, the other takes ref and commit as separate parameters. This is a near-duplicate that emerged because the two files were written independently.
  RECOMMENDATION: Remove formatRef from list-detail.ts and import formatRefLabel from summary.ts instead. Call it as formatRefLabel(entry.ref, entry.commit). Alternatively, add a convenience overload that accepts ManifestEntry.

SUMMARY: Most prior duplication findings have been addressed through extraction of shared utilities (cloneAndReinstall, mapCloneFailure, errorMessage, withExitSignal, readManifestOrExit, validateLocalSourcePath, runConflictChecks, readDirEntries). Two new findings remain: the mapCloneFailure handler blocks are near-identical between list-update-action.ts and list-change-version-action.ts (~25 lines each), and formatRef/formatRefLabel is duplicated between list-detail.ts and summary.ts.
