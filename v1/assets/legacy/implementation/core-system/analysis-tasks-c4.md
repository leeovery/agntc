---
topic: core-system
cycle: 4
total_proposed: 3
---
# Analysis Tasks: Core System (Cycle 4)

## Task 1: Unify runRemoteUpdate and runLocalUpdate in list-update-action.ts and internalize copy-failed manifest removal
status: approved
severity: medium
sources: duplication, architecture

**Problem**: `runRemoteUpdate` (lines 26-79) and `runLocalUpdate` (lines 81-149) in `src/commands/list-update-action.ts` are structurally identical. Both call `cloneAndReinstall`, check for copy-failed and remove the manifest entry, then call `mapCloneFailure` with near-identical handler records (~25 lines duplicated within the same file). The only differences are: (1) `runLocalUpdate` adds a `validateLocalSourcePath` guard and passes `sourceDir`, and (2) two of six message strings differ slightly ("has no agntc.json" vs "New version of ... has no agntc.json"). Additionally, the copy-failed manifest removal check (`result.failureReason === "copy-failed"` then `writeManifest(projectDir, removeEntry(manifest, key))`) is a 3-line block repeated at 4 call sites across 3 files -- this is a pipeline concern that leaks into every consumer of `cloneAndReinstall`.

**Solution**: (1) Unify `runRemoteUpdate` and `runLocalUpdate` into a single `runUpdate(key, entry, manifest, projectDir)` function that determines local vs remote mode from `entry.commit === null`. Parameterize the two differing message strings via a local flag. (2) Move the copy-failed manifest removal into `cloneAndReinstall` itself (it already has access to key and projectDir), or into the `mapCloneFailure` `onCopyFailed` handler defined once in the shared function, eliminating the check from all 4 external call sites.

**Outcome**: list-update-action.ts has one update function instead of two. The copy-failed manifest cleanup is handled in one location rather than repeated at every call site. ~50 lines eliminated from list-update-action.ts and ~9 lines from other files.

**Do**:
1. In `src/commands/list-update-action.ts`, create a single `runUpdate(key: string, entry: ManifestEntry, manifest: Manifest, projectDir: string): Promise<UpdateActionResult>` function.
2. Inside `runUpdate`, check `entry.commit === null` to determine local vs remote mode. For local mode, call `validateLocalSourcePath` first and return early on failure. For remote mode, proceed directly.
3. Call `cloneAndReinstall` with the appropriate parameters (sourceDir for local, ref/commit for remote).
4. Extract a single `mapCloneFailure` handler record that parameterizes the two message-string differences based on a `isLocal` flag.
5. In `src/clone-reinstall.ts` (or wherever `cloneAndReinstall` is defined), move the copy-failed manifest removal logic into the function itself, so consumers do not need to check for copy-failed and call `writeManifest(removeEntry(...))` independently.
6. Remove the copy-failed manifest removal checks from `src/commands/update.ts`, `src/commands/list-update-action.ts`, and `src/commands/list-change-version-action.ts` (all 4 external sites).
7. Remove the now-unused `runRemoteUpdate` and `runLocalUpdate` functions.
8. Update all call sites that invoked `runRemoteUpdate` or `runLocalUpdate` to call the unified `runUpdate`.
9. Verify all existing tests pass.

**Acceptance Criteria**:
- `runRemoteUpdate` and `runLocalUpdate` no longer exist as separate functions in list-update-action.ts
- A single `runUpdate` function handles both local and remote update flows
- The copy-failed manifest removal check does not appear at any external call site of `cloneAndReinstall`
- All existing list-update-action tests pass with identical behavior
- All existing update and list-change-version-action tests pass

**Tests**:
- Existing list-update-action tests for remote updates pass
- Existing list-update-action tests for local updates pass
- Existing update command tests pass (copy-failed handling still works)
- Existing list-change-version-action tests pass
- Copy-failed scenario correctly removes the manifest entry (verified via existing or updated tests)

---

## Task 2: Extract shared conflict-check pipeline in add.ts
status: approved
severity: medium
sources: duplication

**Problem**: The standalone add path (lines ~151-187) and the collection per-plugin loop (lines ~428-470) in `src/commands/add.ts` both implement the same 6-step sequence: computeIncomingFiles, checkFileCollisions, resolveCollisions (with manifest update), checkUnmanagedConflicts, resolveUnmanagedConflicts (with skip handling). Each is ~35 lines. The collection version wraps the cancel path in a `continue` instead of a `throw`, but the core pipeline is identical.

**Solution**: Extract a shared function like `runConflictChecks({ incomingFiles, manifest, pluginKey, projectDir }): Promise<{ updatedManifest: Manifest, proceed: boolean }>` that encapsulates the full collision and unmanaged-conflict pipeline. The standalone path throws on `!proceed`, the collection path continues.

**Outcome**: The 6-step conflict pipeline exists in one place. Any change to the collision/unmanaged resolution flow is made once. ~35 lines of duplication eliminated.

**Do**:
1. In `src/commands/add.ts`, define a function `runConflictChecks(opts: { incomingFiles: string[], manifest: Manifest, pluginKey: string, projectDir: string }): Promise<{ updatedManifest: Manifest, proceed: boolean }>`.
2. Move the 6-step sequence into this function: computeIncomingFiles, checkFileCollisions, resolveCollisions, checkUnmanagedConflicts, resolveUnmanagedConflicts, return updated manifest and whether to proceed.
3. In the standalone add path, call `runConflictChecks` and throw on `!proceed`.
4. In the collection per-plugin loop, call `runConflictChecks` and `continue` on `!proceed`.
5. Ensure both paths pass the correct parameters and handle the result appropriately.
6. Verify all existing tests pass.

**Acceptance Criteria**:
- The collision-check + unmanaged-check sequence exists in exactly one function
- Both the standalone and collection add paths use the shared function
- Cancel behavior is preserved: standalone throws, collection continues to next plugin
- All existing add command tests pass

**Tests**:
- Existing add tests for collision detection and resolution pass
- Existing add tests for unmanaged conflict detection pass
- Existing collection add tests pass
- Cancel during standalone add still aborts the command
- Cancel during collection add still skips to the next plugin

---

## Task 3: Extract withExitSignal wrapper for command actions
status: approved
severity: low
sources: duplication

**Problem**: All four commands (add, remove, update, list) wrap their `.action()` handler in an identical try/catch block that checks for ExitSignal and calls `process.exit(signal.code)`. The block is 7 lines, repeated 4 times with zero variation across `src/commands/add.ts:558-567`, `src/commands/remove.ts:161-170`, `src/commands/update.ts:461-470`, and `src/commands/list.ts:151-160`.

**Solution**: Extract a `withExitSignal(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void>` wrapper that returns an async function handling the ExitSignal catch pattern. Place in `src/exit-signal.ts` alongside the ExitSignal class definition.

**Outcome**: Each command's `.action()` call becomes a one-liner: `.action(withExitSignal(async (source) => runAdd(source)))`. The ExitSignal catch boilerplate exists in one place.

**Do**:
1. In `src/exit-signal.ts` (or wherever ExitSignal is defined), add `export function withExitSignal<T extends (...args: any[]) => Promise<void>>(fn: T): T`.
2. Implement: return an async function that wraps `fn` in try/catch, checking `if (err instanceof ExitSignal) process.exit(err.code)` and re-throwing otherwise.
3. In `src/commands/add.ts`, replace the try/catch action wrapper with `withExitSignal(async (source) => { ... })`.
4. In `src/commands/remove.ts`, replace the try/catch action wrapper with `withExitSignal(async (key) => { ... })`.
5. In `src/commands/update.ts`, replace the try/catch action wrapper with `withExitSignal(async (key) => { ... })`.
6. In `src/commands/list.ts`, replace the try/catch action wrapper with `withExitSignal(async () => { ... })`.
7. Remove the now-unused try/catch blocks from all four files.
8. Verify all existing tests pass.

**Acceptance Criteria**:
- No command file contains an inline try/catch block checking for ExitSignal
- All four commands use `withExitSignal` to wrap their action handlers
- ExitSignal handling behavior is identical to current (calls process.exit with the signal's code)
- All existing tests pass

**Tests**:
- Existing tests for all four commands pass
- withExitSignal calls process.exit when ExitSignal is thrown
- withExitSignal re-throws non-ExitSignal errors
