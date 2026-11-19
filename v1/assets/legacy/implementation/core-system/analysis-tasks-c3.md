---
topic: core-system
cycle: 3
total_proposed: 5
---
# Analysis Tasks: Core System (Cycle 3)

## Task 1: Extract failure-reason mapper and unify update orchestration functions
status: approved
severity: high
sources: duplication, architecture

**Problem**: Every consumer of `cloneAndReinstall()` independently dispatches on `result.failureReason` with an if-chain checking "clone-failed", "no-config", "no-agents", "invalid-type", "copy-failed", and a fallback. This chain is ~30 lines and appears 6 times across `src/commands/update.ts` (runGitUpdate:112-141, runLocalUpdate:192-219, processGitUpdateForAll:253-291, processLocalUpdateForAll:340-377), `src/commands/list-update-action.ts` (runRemoteUpdate:37-68, runLocalUpdate:112-142), and `src/commands/list-change-version-action.ts` (53-84). Additionally, `update.ts` has four near-identical functions (runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll) that differ only in how they surface outcomes (throw ExitSignal vs return PluginOutcome) and whether they validate local paths. Adding a new failure reason requires updating all 6 sites. This was flagged in c2 but remains unaddressed at the consumer level.

**Solution**: Define a generic `mapCloneFailure<T>` function in `src/clone-reinstall.ts` that accepts a `CloneReinstallFailed` result and a handler record with one callback per failure reason, returning `T`. Each call site provides its thin handler record (e.g., messages and return-type wrappers). Additionally, unify the four update functions in `update.ts` into a single `processUpdate` function that returns `PluginOutcome`, with the single-plugin path (runUpdate with a key) calling it and mapping PluginOutcome to throws/logs. The git vs local distinction is already handled inside `cloneAndReinstall` via the `sourceDir` parameter.

**Outcome**: The failure-reason dispatch exists in one location. Adding a new failure reason requires changes in one place and produces a compile error if any handler is missing. Each consumer is reduced from ~30 lines of if-chains to ~5-10 lines of handler definitions. The four update functions in update.ts are reduced to one or two.

**Do**:
1. In `src/clone-reinstall.ts`, define a handler interface: `CloneFailureHandlers<T> = { onCloneFailed: (msg: string) => T, onNoConfig: (msg: string) => T, onNoAgents: (msg: string) => T, onInvalidType: (msg: string) => T, onCopyFailed: (msg: string) => T, onUnknown: (msg: string) => T }`.
2. Export `mapCloneFailure<T>(result: CloneReinstallFailed, handlers: CloneFailureHandlers<T>): T` that dispatches to the appropriate handler based on `result.failureReason`.
3. In `src/commands/update.ts`, replace the if-chains in `runGitUpdate` and `runLocalUpdate` with calls to `mapCloneFailure` providing handlers that throw ExitSignal or return null as appropriate.
4. In `src/commands/update.ts`, replace `processGitUpdateForAll` and `processLocalUpdateForAll` with a single `processUpdateForAll(key, entry, projectDir)` function that calls `cloneAndReinstall` (with `sourceDir` for local paths) and uses `mapCloneFailure` to return `PluginOutcome`. Keep the local-path validation inline for the batch path.
5. In `src/commands/list-update-action.ts`, replace the if-chains in `runRemoteUpdate` and `runLocalUpdate` with calls to `mapCloneFailure` providing handlers that return `UpdateActionResult`.
6. In `src/commands/list-change-version-action.ts`, replace the if-chain with a call to `mapCloneFailure` providing handlers that return `ChangeVersionResult`.
7. Remove all now-unused duplicated if-chain code.
8. Verify all existing tests pass without modification.

**Acceptance Criteria**:
- The failure-reason if-chain exists in exactly one location (the `mapCloneFailure` function)
- All consumers use `mapCloneFailure` with typed handler records
- All update/list-update/list-change-version flows produce identical user-visible output as before
- update.ts has at most 2 update orchestration functions (single + batch), down from 4

**Tests**:
- Existing update command tests pass (single git update, single local update, batch update all)
- Existing list-update-action tests pass (remote update, local update)
- Existing list-change-version-action tests pass
- Each failure reason (no-config, no-agents, invalid-type, copy-failed, clone-failed, unknown) produces the same error messages/behavior as before

## Task 2: Extract local path validation helper
status: approved
severity: medium
sources: duplication

**Problem**: The pattern of calling `stat(sourcePath)`, checking `isDirectory()`, and producing a "does not exist or is not a directory" error is repeated in 3 places: `src/commands/update.ts:158-174` (validateLocalPath), `src/commands/update.ts:316-331` (inline in processLocalUpdateForAll), and `src/commands/list-update-action.ts:90-103` (inline in runLocalUpdate). Each is ~15 lines with identical structure. The update.ts version throws ExitSignal while the other two return error results, but the core validation logic is the same.

**Solution**: Extract a `validateLocalSourcePath(path: string): Promise<{ valid: true } | { valid: false; reason: string }>` helper into `src/fs-utils.ts` (or extend an existing utility module). The function performs the stat + isDirectory check and returns a result type. Each call site maps the result to its own error handling (throw or return).

**Outcome**: Local path validation logic exists in one place. The 3 call sites become thin wrappers that map the validation result to their context-specific error handling.

**Do**:
1. Create or extend `src/fs-utils.ts` with `validateLocalSourcePath(path: string): Promise<{ valid: true } | { valid: false; reason: string }>`.
2. Implement: call `stat(path)`, check `isDirectory()`. Return `{ valid: false, reason: "path is not a directory" }` if not a directory, `{ valid: false, reason: "path does not exist" }` if stat throws.
3. In `src/commands/update.ts`, replace `validateLocalPath` (lines 158-174) to call `validateLocalSourcePath` and throw ExitSignal on invalid.
4. In `src/commands/update.ts`, replace inline validation in `processLocalUpdateForAll` (lines 316-331) to call `validateLocalSourcePath` and return PluginOutcome on invalid.
5. In `src/commands/list-update-action.ts`, replace inline validation in `runLocalUpdate` (lines 90-103) to call `validateLocalSourcePath` and return UpdateActionResult on invalid.
6. Remove now-unused inline validation code.

**Acceptance Criteria**:
- Local path stat+isDirectory validation exists in exactly one function
- All 3 call sites use the shared function
- Error messages remain consistent with current behavior

**Tests**:
- Existing update tests pass for local path validation failures
- Existing list-update-action tests pass for local path validation failures
- validateLocalSourcePath returns valid:true for existing directories
- validateLocalSourcePath returns valid:false for non-existent paths
- validateLocalSourcePath returns valid:false for file paths (not directories)

## Task 3: Extract readManifestOrExit helper
status: approved
severity: medium
sources: duplication

**Problem**: Three commands read the manifest with an identical `.catch()` block that extracts the error message, logs it via `p.log.error`, and throws `ExitSignal(1)`. This 5-line pattern appears in `src/commands/update.ts:34-38`, `src/commands/list.ts:76-80`, and `src/commands/remove.ts:72-76`. The structure is identical each time.

**Solution**: Extract a `readManifestOrExit(projectDir: string): Promise<Manifest>` helper that encapsulates the `.catch()` + ExitSignal pattern. Place in `src/manifest.ts` alongside the existing `readManifest`.

**Outcome**: Manifest-read-with-error-handling exists in one place. Each command calls `readManifestOrExit` instead of duplicating the catch block.

**Do**:
1. In `src/manifest.ts`, add `readManifestOrExit(projectDir: string): Promise<Manifest>` that calls `readManifest(projectDir)` and catches errors with the standard pattern: extract message, `p.log.error("Failed to read manifest: {message}")`, throw `ExitSignal(1)`.
2. In `src/commands/update.ts`, replace lines 34-38 with `const manifest = await readManifestOrExit(projectDir)`.
3. In `src/commands/list.ts`, replace the equivalent catch block with `readManifestOrExit`.
4. In `src/commands/remove.ts`, replace the equivalent catch block with `readManifestOrExit`.
5. Update imports in all three files.

**Acceptance Criteria**:
- No command file contains a `.catch()` block that logs manifest read errors and throws ExitSignal
- All three commands use `readManifestOrExit`
- Error messages remain identical to current behavior

**Tests**:
- Existing tests for update, list, and remove pass with manifest read errors
- readManifestOrExit throws ExitSignal(1) when manifest cannot be read

## Task 4: Extract errorMessage utility function
status: approved
severity: low
sources: duplication

**Problem**: The expression `err instanceof Error ? err.message : String(err)` appears 13 times across the codebase: `src/clone-reinstall.ts:88`, `src/config.ts:43`, `src/commands/update.ts:35,391,404`, `src/commands/list.ts:77`, `src/commands/list-update-action.ts:154`, `src/commands/add.ts:251,513`, `src/commands/remove.ts:73`, `src/nuke-reinstall-pipeline.ts:128`, `src/copy-rollback.ts:15`, `src/update-check-all.ts:20`. Each is a single expression but the sheer repetition indicates a missing utility.

**Solution**: Extract `function errorMessage(err: unknown): string` into `src/errors.ts` (alongside the existing `isNodeError` if present, or as a new file). Replace all 13 occurrences.

**Outcome**: Error message extraction is a single utility function. All catch blocks use it consistently.

**Do**:
1. Create or extend `src/errors.ts` with `export function errorMessage(err: unknown): string { return err instanceof Error ? err.message : String(err); }`.
2. Replace all 13 occurrences of `err instanceof Error ? err.message : String(err)` with `errorMessage(err)`.
3. Add the import to each affected file.

**Acceptance Criteria**:
- No file contains the inline `err instanceof Error ? err.message : String(err)` expression
- All 13 sites use the shared `errorMessage` function
- No behavioral change

**Tests**:
- All existing tests pass
- errorMessage returns the message property for Error instances
- errorMessage returns String(err) for non-Error values

## Task 5: Narrow tree URL @ref rejection to path portion only
status: approved
severity: low
sources: standards

**Problem**: `parseDirectPath` in `src/source-parser.ts:134-137` rejects any tree URL containing `@` anywhere in the string (`if (input.includes("@"))`). This would incorrectly reject legitimate URLs containing `@` in non-ref positions, such as `https://user@github.com/owner/repo/tree/main/plugin` (authenticated URLs). The spec intent is to reject `@ref` suffixes appended after the URL, not `@` characters within the URL structure.

**Solution**: Narrow the check to only reject `@` after the hostname/path portion. Since tree URLs have the structure `https://{host}/{owner}/{repo}/tree/{ref}/{plugin}`, check whether `@` appears after the `/tree/` segment or as a suffix to the overall URL, rather than anywhere in the string.

**Outcome**: Tree URLs with `@` in the authentication portion or hostname are accepted. Only `@ref` suffixes meant for version pinning are rejected, matching spec intent.

**Do**:
1. In `src/source-parser.ts`, locate `parseDirectPath` (line 133).
2. Replace `if (input.includes("@"))` with a check that only examines the portion after the hostname. For example: extract the path after `https://{host}/` and check if that path portion contains `@`.
3. Alternatively, check if `@` appears after the last `/tree/...` segment, which would be the suffix position.
4. Ensure the existing test for `@ref` rejection on tree URLs still passes.

**Acceptance Criteria**:
- `https://github.com/owner/repo/tree/main/plugin` is accepted (no @)
- `https://github.com/owner/repo/tree/main/plugin@v2` is rejected (@ as ref suffix in path)
- `https://user@github.com/owner/repo/tree/main/plugin` would not be rejected by the @ check (@ is in auth portion)
- Existing source-parser tests pass

**Tests**:
- Existing tree URL parsing tests pass
- Tree URL with @ref suffix after path is still rejected
- Standard tree URLs without @ continue to parse correctly
