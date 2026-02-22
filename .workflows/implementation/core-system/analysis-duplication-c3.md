AGENT: duplication
FINDINGS:
- FINDING: CloneReinstallResult failure-reason dispatch repeated across 5 call sites
  SEVERITY: high
  FILES: src/commands/update.ts:112-141, src/commands/update.ts:192-219, src/commands/update.ts:253-291, src/commands/list-update-action.ts:37-68, src/commands/list-update-action.ts:112-142, src/commands/list-change-version-action.ts:53-84
  DESCRIPTION: Every consumer of `cloneAndReinstall()` independently dispatches on `result.failureReason` with a chain of if-statements checking "no-config", "no-agents", "invalid-type", "copy-failed", and fallback. The chain is ~30 lines each time and appears 6 times (update.ts x4 via runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll; list-update-action.ts x2 via runRemoteUpdate, runLocalUpdate; list-change-version-action.ts x1). The logic is structurally identical -- only the return wrapper differs (some throw ExitSignal, some return PluginOutcome, some return UpdateActionResult/ChangeVersionResult).
  RECOMMENDATION: Extract a generic failure mapper that takes CloneReinstallFailed and a callback/adapter for the return type. For example, a `mapCloneFailure<T>(result, handlers)` function in clone-reinstall.ts that accepts per-reason formatters. Each call site provides only the thin adapter (e.g., message text or whether to throw vs return). This eliminates the 6-way copy-paste of the if-chain and centralizes future failure-reason additions.

- FINDING: Local path validation (stat + isDirectory check) duplicated 3 times
  SEVERITY: medium
  FILES: src/commands/update.ts:158-174, src/commands/update.ts:316-331, src/commands/list-update-action.ts:90-103
  DESCRIPTION: The pattern of calling `stat(sourcePath)`, checking `isDirectory()`, and producing a "does not exist or is not a directory" error message is repeated in 3 places. Each is ~15 lines with identical structure. source-parser.ts has a similar but slightly different version for its own purposes. The 3 copies in update paths are near-identical.
  RECOMMENDATION: Extract a `validateLocalSourcePath(path: string): Promise<void>` helper (or a variant returning a result type) into a shared module (e.g., fs-utils.ts). The 3 call sites in update.ts and list-update-action.ts call this instead of inlining the stat+check.

- FINDING: Manifest read with .catch + ExitSignal pattern repeated 3 times
  SEVERITY: medium
  FILES: src/commands/update.ts:33-38, src/commands/list.ts:76-80, src/commands/remove.ts:72-76
  DESCRIPTION: Three commands read the manifest with an identical `.catch()` block that extracts the error message, logs it, and throws ExitSignal(1). The pattern is 5 lines each time, identical in structure.
  RECOMMENDATION: Extract a `readManifestOrExit(projectDir: string): Promise<Manifest>` helper that encapsulates the .catch + ExitSignal pattern. Place in manifest.ts or a command-level shared module.

- FINDING: File classification by path segment duplicated between remove and list-detail
  SEVERITY: low
  FILES: src/commands/remove.ts:38-43, src/commands/list-detail.ts:41-48
  DESCRIPTION: Both `classifyFile()` in remove.ts and `classifyAssetType()` in list-detail.ts classify files by checking `includes("/skills/")`, `includes("/agents/")`, `includes("/hooks/")`. They return slightly different types (string vs keyof AssetCounts) but the logic is identical.
  RECOMMENDATION: Extract a shared `classifyFileByAssetType(path: string)` function returning a union type, placed in fs-utils.ts or a new asset-utils.ts. Both call sites use it.

- FINDING: "err instanceof Error ? err.message : String(err)" repeated 13 times
  SEVERITY: low
  FILES: src/clone-reinstall.ts:88, src/config.ts:43, src/commands/update.ts:35, src/commands/update.ts:391, src/commands/update.ts:404, src/commands/list.ts:77, src/commands/list-update-action.ts:154, src/commands/add.ts:251, src/commands/add.ts:513, src/commands/remove.ts:73, src/nuke-reinstall-pipeline.ts:128, src/copy-rollback.ts:15, src/update-check-all.ts:20
  DESCRIPTION: This exact error-message extraction expression appears 13 times across the codebase. Each is a single expression, so individually trivial, but the sheer repetition suggests a missing utility.
  RECOMMENDATION: Extract `function errorMessage(err: unknown): string` into errors.ts alongside the existing `isNodeError`. Replace all 13 occurrences.

SUMMARY: The dominant duplication is the CloneReinstallResult failure-reason dispatch chain, which is ~30 lines repeated 6 times across update and list-action commands. Secondary issues include local-path validation (3x), manifest-read-or-exit (3x), and file classification (2x). All are straightforward extraction candidates that would reduce the total duplicated line count by ~200 lines.
