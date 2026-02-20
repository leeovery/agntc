---
topic: core-system
cycle: 1
total_proposed: 11
---
# Analysis Tasks: Core System (Cycle 1)

## Task 1: Extract shared nuke-and-reinstall pipeline
status: pending
severity: high
sources: duplication

**Problem**: The core update pipeline (readConfig, computeEffectiveAgents, detectType, build agent+driver pairs, nukeManifestFiles, conditional copy, construct ManifestEntry) is independently implemented 6+ times across `src/commands/update.ts`, `src/commands/list-update-action.ts`, and `src/commands/list-change-version-action.ts`. This is ~250 lines of near-identical logic with minor variations in error handling style and ManifestEntry field construction. The dropped-agents warning message string is copy-pasted identically across all of them.

**Solution**: Extract a shared function (e.g., `executeNukeAndReinstall`) in a new module (e.g., `src/nuke-reinstall-pipeline.ts`) that takes a sourceDir, manifest entry, key, projectDir, and an options bag (onWarn callback, new ref/commit values) and returns the new ManifestEntry + copiedFiles. Each call site reduces to: resolve sourceDir, call the shared pipeline, handle the result per its own error convention.

**Outcome**: One canonical implementation of the nuke-and-reinstall pipeline. Call sites in update.ts (runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll), list-update-action.ts, and list-change-version-action.ts each become thin wrappers (~10 lines) that resolve the source directory and call the shared function. ~200 lines of duplicate code eliminated.

**Do**:
1. Create `src/nuke-reinstall-pipeline.ts` with a function that encapsulates the shared pipeline: readConfig from sourceDir, compute effective agents (intersection of manifest agents and new config agents), detect type, build agent+driver pairs, nuke existing manifest files, copy (plugin or bare-skill), construct new ManifestEntry
2. Define an options interface for the function: `{ key: string; sourceDir: string; existingEntry: ManifestEntry; projectDir: string; newRef?: string | null; newCommit?: string | null; onAgentsDropped?: (dropped: string[], kept: string[]) => void }`
3. Return a result object: `{ entry: ManifestEntry; copiedFiles: string[]; droppedAgents: string[] }`
4. Refactor `runGitUpdate` and `runLocalUpdate` in update.ts to use the shared function
5. Refactor `processGitUpdateForAll` and `processLocalUpdateForAll` in update.ts to use the shared function
6. Refactor `runRemoteUpdate` and `runLocalUpdate` in list-update-action.ts to use the shared function
7. Refactor `executeChangeVersionAction` in list-change-version-action.ts to use the shared function
8. Consolidate the buildParsedSource/getSourceDir helpers that were only needed because the pipeline was duplicated (see also Task 10)
9. Ensure all existing tests pass -- update mocks as needed to point at the new module

**Acceptance Criteria**:
- The nuke-and-reinstall sequence exists in exactly one function
- All 6+ call sites delegate to the shared function
- No behavioral changes -- same warnings, same manifest entries, same error handling at each call site
- All existing unit tests pass (with updated mocks where needed)

**Tests**:
- Unit test the shared pipeline function with mocked dependencies: verify it calls nukeManifestFiles, readConfig, detectType, copy functions, and returns correct ManifestEntry
- Test that dropped-agents warning callback is invoked when new config removes agents
- Test that when all agents are dropped, the function returns appropriately (no copy, signal to caller)
- Verify existing command-level tests still pass after refactor

---

## Task 2: Add collection prefix matching to update command
status: pending
severity: high
sources: standards

**Problem**: The spec defines three invocation modes for `update`: no-arg (all), `owner/repo` (specific plugin or all from collection), and `owner/repo/plugin-name` (specific collection plugin). The implementation does a direct manifest lookup (`manifest[key]`) which fails with "Plugin {key} is not installed" when `owner/repo` is passed but the manifest only contains collection entries like `owner/repo/plugin-name`. The `remove` command correctly implements this via `resolveTargetKeys` with prefix matching, but `update` lacks equivalent logic.

**Solution**: Add prefix-matching logic to `runUpdate` in `src/commands/update.ts` (similar to `resolveTargetKeys` in `src/commands/remove.ts`) so that `npx agntc update owner/repo` resolves to all collection plugins under that prefix and updates them sequentially.

**Outcome**: `npx agntc update owner/repo` correctly finds and updates all collection plugins whose keys start with `owner/repo/`, matching the spec and the behavior already implemented in the `remove` command.

**Do**:
1. Extract or reuse the `resolveTargetKeys` logic from `src/commands/remove.ts` -- either import it directly or extract to a shared manifest utility
2. In `runUpdate` (src/commands/update.ts), replace the direct `manifest[key]` lookup with prefix-matching resolution
3. When prefix matching finds multiple keys, iterate and update each one sequentially (same as remove does)
4. When prefix matching finds zero keys, display "Plugin {key} is not installed." and exit with non-zero code (existing behavior)
5. Ensure the single-key exact match path still works as before

**Acceptance Criteria**:
- `npx agntc update owner/repo` updates all collection plugins under that prefix
- `npx agntc update owner/repo/plugin-name` updates that specific plugin (exact match)
- `npx agntc update nonexistent/repo` shows "Plugin nonexistent/repo is not installed." error
- Behavior matches the remove command's resolution logic

**Tests**:
- Test that `update owner/repo` resolves to multiple collection keys and updates each
- Test that `update owner/repo/plugin-name` resolves to exact match
- Test that `update nonexistent/key` produces the correct error message
- Test edge case: `owner/repo` exists as both a standalone key and a collection prefix -- exact match takes priority

---

## Task 3: Fix nuke-before-copy data loss risk on copy failure
status: pending
severity: high
sources: architecture

**Problem**: In the update pipeline, the sequence is: nuke existing files -> copy new files. If copy fails after nuke (disk full, permission error), the user's installed files are gone with no recovery path. The spec says "Rollback to clean state" for partial copy failures, but rollback only deletes newly-copied files -- it cannot restore the nuked originals. This is a latent data-loss risk.

**Solution**: Before nuking, record the list of files that will be removed. If copy fails after nuke, log a clear recovery message: "Update failed after removing old files. Run `npx agntc update {key}` to retry." This is the minimum viable safety net within the current nuke-and-reinstall architecture. A more robust fix (staging area + atomic swap) can be considered later.

**Outcome**: Users who hit a copy failure during update get a clear, actionable message telling them how to recover, rather than being left in a silently broken state.

**Do**:
1. In the nuke-and-reinstall pipeline (whether in the shared function from Task 1 or in the current individual implementations), wrap the copy step in a try/catch
2. If copy fails after nuke has completed, catch the error and log a prominent warning: "Update failed for {key} after removing old files. The plugin is currently uninstalled. Run `npx agntc update {key}` to retry installation."
3. Remove the plugin's manifest entry (since files are gone) so the state is consistent -- or alternatively, keep the entry so update can retry
4. Re-throw or return the error so the caller can handle it appropriately
5. This task is independent of Task 1 -- apply to whichever code structure exists at execution time

**Acceptance Criteria**:
- Copy failure after nuke produces a clear, user-facing recovery message
- The manifest state is consistent with the filesystem state after failure
- No silent data loss -- the user always knows what happened and how to fix it

**Tests**:
- Mock copy to throw after nuke succeeds, verify the recovery message is output
- Verify manifest state is consistent after copy failure (entry removed or marked for retry)
- Verify the error propagates to the caller

---

## Task 4: Strengthen type safety for AssetType, AgentId, and AgentWithDriver
status: pending
severity: medium
sources: architecture, duplication

**Problem**: Three related type safety gaps: (1) `AgentDriver.getTargetDir` accepts `string` when the valid asset types are the known finite set `"skills" | "agents" | "hooks"`. (2) `ManifestEntry.agents` and `AgntcConfig.agents` are typed as `string[]` instead of `AgentId[]`, forcing `as AgentId[]` casts at ~12 call sites. (3) The `AgentWithDriver` interface is independently declared in 3 files (copy-bare-skill.ts, copy-plugin-assets.ts, compute-incoming-files.ts).

**Solution**: (1) Define `type AssetType = typeof ASSET_DIRS[number]` and use it in `getTargetDir(assetType: AssetType)`. (2) Change `ManifestEntry.agents` and `AgntcConfig.agents` to `AgentId[]`. (3) Export `AgentWithDriver` from `src/drivers/types.ts` and import in the three consuming files.

**Outcome**: Compile-time validation catches invalid asset type strings and agent identifiers. No more `as AgentId[]` casts. `AgentWithDriver` defined once.

**Do**:
1. In `src/type-detection.ts`, export `type AssetType = typeof ASSET_DIRS[number]`
2. In `src/drivers/types.ts`, change `getTargetDir(assetType: string)` to `getTargetDir(assetType: AssetType)` (import AssetType from type-detection)
3. Update `src/drivers/claude-driver.ts` and `src/drivers/codex-driver.ts` internal `TARGET_DIRS` records to use `Partial<Record<AssetType, string>>`
4. In `src/drivers/types.ts`, add `export interface AgentWithDriver { id: AgentId; driver: AgentDriver }`
5. Remove the local `AgentWithDriver` declarations from `src/copy-bare-skill.ts`, `src/copy-plugin-assets.ts`, `src/compute-incoming-files.ts` and import from `src/drivers/types.ts`
6. In `src/manifest.ts`, change `ManifestEntry.agents` from `string[]` to `AgentId[]` (import AgentId from drivers/types)
7. In `src/config.ts`, change `AgntcConfig.agents` from `string[]` to `AgentId[]`
8. Remove all `as AgentId[]` casts across the codebase (at least 12 occurrences in add.ts, update.ts, list-update-action.ts, list-change-version-action.ts)
9. Fix any resulting type errors -- the validation in `readConfig` already filters to known agents, so the return type naturally becomes `AgentId[]`
10. Verify all tests compile and pass

**Acceptance Criteria**:
- `getTargetDir` only accepts `"skills" | "agents" | "hooks"` at compile time
- `ManifestEntry.agents` and `AgntcConfig.agents` are typed `AgentId[]`
- Zero `as AgentId[]` casts remain in the codebase
- `AgentWithDriver` is defined in exactly one file and imported elsewhere
- All tests pass

**Tests**:
- Existing unit tests should pass without modification (behavioral no-op)
- Verify TypeScript compilation catches a test file that passes an invalid string to getTargetDir (manual check during development)

---

## Task 5: Store original clone URL in manifest to fix non-GitHub update flows
status: pending
severity: medium
sources: architecture

**Problem**: `update-check.ts` derives the clone URL from the manifest key by hardcoding `https://github.com/${owner}/${repo}.git`. The same pattern is repeated via `buildParsedSource` in update.ts and list-update-action.ts. Plugins originally installed via HTTPS from GitLab/Bitbucket or via SSH will have update checks and re-clones pointed at github.com instead of the original host. The manifest stores only `owner/repo` as the key -- the original host is lost during key derivation.

**Solution**: Add a `cloneUrl: string | null` field to `ManifestEntry`. Populate it during `add` from the parsed source. Use it during update checks and re-clones instead of reconstructing from the key. `null` for local path installs.

**Outcome**: Update checks and re-clones use the original clone URL, correctly handling non-GitHub git hosts and SSH URLs.

**Do**:
1. Add `cloneUrl: string | null` to the `ManifestEntry` interface in `src/manifest.ts`
2. In the `add` command (`src/commands/add.ts`), populate `cloneUrl` from the parsed source (the full HTTPS/SSH URL, or `null` for local paths)
3. In `src/update-check.ts`, use `entry.cloneUrl` instead of `deriveCloneUrl(key)` for git ls-remote. Fall back to the github.com derivation if cloneUrl is null (backward compatibility with existing manifests)
4. In `src/commands/update.ts`, use `entry.cloneUrl` for re-cloning instead of rebuilding from key
5. In `src/commands/list-update-action.ts` and `src/commands/list-change-version-action.ts`, use `entry.cloneUrl` for re-cloning
6. Handle backward compatibility: existing manifests without `cloneUrl` fall back to current github.com derivation behavior
7. Update all tests that construct ManifestEntry objects to include the new field

**Acceptance Criteria**:
- ManifestEntry has a `cloneUrl` field
- New installs store the original clone URL
- Update checks use the stored URL, not a reconstructed one
- Existing manifests without `cloneUrl` still work (backward compatible)

**Tests**:
- Test that `add` from a GitLab HTTPS URL stores the correct cloneUrl
- Test that `add` from SSH URL stores the correct cloneUrl
- Test that `add` from local path stores `null`
- Test that update-check uses entry.cloneUrl when available
- Test backward compatibility: entry without cloneUrl falls back to github.com derivation

---

## Task 6: Fix config validation error messages to include spec-required prefix
status: pending
severity: medium
sources: standards

**Problem**: The spec defines error messages "Invalid agntc.json: agents field is required" and "Invalid agntc.json: agents must not be empty". The implementation throws ConfigError with messages "agents field is required" and "agents must not be empty" -- missing the "Invalid agntc.json:" prefix. The JSON parse error correctly includes the prefix, but the structural validation errors do not.

**Solution**: Add the "Invalid agntc.json: " prefix to the two structural validation error messages in `src/config.ts`.

**Outcome**: All config validation errors consistently include the spec-required prefix.

**Do**:
1. In `src/config.ts` line 50, change the error message from `"agents field is required"` to `"Invalid agntc.json: agents field is required"`
2. In `src/config.ts` line 56, change the error message from `"agents must not be empty"` to `"Invalid agntc.json: agents must not be empty"`
3. Update any tests that assert on these exact error message strings

**Acceptance Criteria**:
- Missing agents field error: "Invalid agntc.json: agents field is required"
- Empty agents array error: "Invalid agntc.json: agents must not be empty"
- Matches the spec exactly

**Tests**:
- Test that missing agents field produces error with "Invalid agntc.json:" prefix
- Test that empty agents array produces error with "Invalid agntc.json:" prefix

---

## Task 7: Fix computeIncomingFiles granularity for plugin collision/unmanaged checks
status: pending
severity: medium
sources: standards

**Problem**: The spec states unmanaged conflict detection operates at the "asset level" -- each skill directory, each agent file, each hook file is one conflict. The `computePluginFiles` function in `src/compute-incoming-files.ts` produces parent target directory paths (e.g., `.claude/skills/`, `.claude/agents/`) rather than individual asset paths within those directories. This means collision and unmanaged checks operate at the wrong granularity for plugin mode. Bare-skill mode is correct.

**Solution**: `computePluginFiles` should scan the source asset directories and produce individual asset-level paths (e.g., `.claude/skills/planning/`, `.claude/agents/executor.md`) rather than parent directory paths.

**Outcome**: Collision and unmanaged conflict checks operate at the correct asset-level granularity as specified, enabling accurate per-asset conflict detection for plugins.

**Do**:
1. Modify `computePluginFiles` in `src/compute-incoming-files.ts` to accept the source directory as an additional parameter
2. For each asset type directory found (skills/, agents/, hooks/), scan its contents to enumerate individual assets
3. For skills: each subdirectory becomes a path entry (e.g., `.claude/skills/planning/`)
4. For agents: each file becomes a path entry (e.g., `.claude/agents/executor.md`)
5. For hooks: each file becomes a path entry (e.g., `.claude/hooks/pre-commit.sh`)
6. Update all call sites of `computePluginFiles` to pass the source directory
7. Verify that `checkFileCollisions` and `checkUnmanagedFiles` work correctly with the new fine-grained paths
8. Update existing tests for compute-incoming-files

**Acceptance Criteria**:
- Plugin incoming files are enumerated at individual asset level, not parent directory level
- Skill directories, agent files, and hook files each produce their own path entry
- Collision checks match at asset granularity
- Bare-skill mode behavior unchanged

**Tests**:
- Test computePluginFiles with a source dir containing skills/planning/, skills/review/, agents/executor.md -- verify all individual paths are produced
- Test that collision check correctly identifies overlapping individual assets between plugins
- Test that unmanaged check correctly identifies individual existing assets

---

## Task 8: Extract shared isNodeError type guard
status: pending
severity: medium
sources: duplication

**Problem**: The identical function `isNodeError(err: unknown): err is NodeJS.ErrnoException` checking `err instanceof Error && "code" in err` is defined independently in `src/config.ts`, `src/manifest.ts`, and `src/nuke-files.ts`.

**Solution**: Extract to a shared utility module and import from the three consuming files.

**Outcome**: One definition of `isNodeError`, imported by all consumers. Eliminates copy-paste drift risk.

**Do**:
1. Create `src/errors.ts` (or add to an existing utils module) with the exported `isNodeError` function
2. Remove the local `isNodeError` from `src/config.ts`, `src/manifest.ts`, and `src/nuke-files.ts`
3. Add `import { isNodeError } from "./errors"` to each file
4. Verify all tests pass

**Acceptance Criteria**:
- `isNodeError` is defined in exactly one file
- All three consumers import from the shared location
- No behavioral change

**Tests**:
- Existing tests should pass without modification

---

## Task 9: Extract shared execGit helper
status: pending
severity: medium
sources: duplication

**Problem**: Both `src/git-clone.ts` and `src/update-check.ts` define their own `execGit` wrapper around `child_process.execFile`. The implementations are structurally identical -- promise wrapper, git error with stderr, resolve/reject. Only the timeout differs (60s for clone, 15s for update-check).

**Solution**: Extract a shared `execGit(args, options?)` into `src/git-utils.ts` that accepts an optional timeout parameter with a sensible default.

**Outcome**: One `execGit` implementation, two call sites passing their desired timeouts.

**Do**:
1. Create `src/git-utils.ts` with `execGit(args: string[], options?: { timeout?: number; cwd?: string }): Promise<string>`
2. Move the promise-wrapped execFile logic from either file into the shared module
3. Update `src/git-clone.ts` to import and use the shared `execGit` with `{ timeout: 60_000 }`
4. Update `src/update-check.ts` to import and use the shared `execGit` with `{ timeout: 15_000 }`
5. Verify all tests pass

**Acceptance Criteria**:
- `execGit` is defined in exactly one file
- Both consumers import from the shared location and pass their own timeouts
- No behavioral change

**Tests**:
- Existing git-clone and update-check tests should pass without modification

---

## Task 10: Extract shared buildParsedSource and getSourceDir helpers
status: pending
severity: medium
sources: duplication

**Problem**: Both `buildParsedSource(key, ...)` and `getSourceDir(tempDir, key)` are independently implemented in `src/commands/update.ts`, `src/commands/list-update-action.ts`, and `src/commands/list-change-version-action.ts`. The implementations are nearly identical -- buildParsedSource splits the key on "/" to extract owner/repo and constructs a ParsedSource, getSourceDir joins remaining key segments onto tempDir.

**Solution**: Extract both into a shared module (e.g., add to `src/source-parser.ts` or create `src/manifest-key-utils.ts`). Normalize `buildParsedSource` to accept `(key: string, ref: string | null)` to cover both calling conventions.

**Outcome**: One implementation of each helper, imported by three consuming files. ~60 lines of duplication eliminated.

**Do**:
1. Add `buildParsedSourceFromKey(key: string, ref: string | null): ParsedSource` to `src/source-parser.ts` (or create a new module)
2. Add `getSourceDirFromKey(tempDir: string, key: string): string` to the same module
3. Remove local implementations from `src/commands/update.ts`, `src/commands/list-update-action.ts`, and `src/commands/list-change-version-action.ts`
4. Update imports in all three files
5. Verify all tests pass

**Acceptance Criteria**:
- `buildParsedSource` and `getSourceDir` each defined in exactly one file
- All three consumers import from the shared location
- No behavioral change

**Tests**:
- Unit test buildParsedSourceFromKey with standalone key ("owner/repo") and collection key ("owner/repo/plugin")
- Unit test getSourceDirFromKey with both key formats
- Existing command tests should pass without modification

---

## Task 11: Add filesystem-based integration tests for core workflows
status: pending
severity: medium
sources: architecture

**Problem**: All command-level tests mock every dependency, verifying orchestration in isolation. There are no tests exercising real interaction between modules (e.g., computeIncomingFiles -> checkFileCollisions -> copyPluginAssets -> writeManifest). Seam defects like path-format mismatches between modules would go undetected.

**Solution**: Add a small set of filesystem-based integration tests that exercise the add/update/remove pipelines end-to-end against temp directories. Mock only interactive prompts (clack) and git operations (network). Use real file operations.

**Outcome**: Cross-module path format consistency is validated. Seam defects between compute, check, copy, and manifest modules are caught.

**Do**:
1. Create `tests/integration/` directory
2. Create test helper that sets up a temp directory with a fake project structure and a fake plugin source directory
3. Write integration test: bare skill add -- real computeIncomingFiles, real copyBareSkill, real writeManifest, verify files on disk match manifest
4. Write integration test: plugin add with collision -- real file operations, verify collision detection works with actual file paths
5. Write integration test: update with agent drop -- add a plugin, modify the source agntc.json to drop an agent, update, verify correct files removed/kept
6. Write integration test: remove -- add a plugin, remove it, verify files deleted and manifest cleaned
7. Mock only: clack prompts (return predetermined selections), git clone (copy from local fixture instead)
8. Clean up temp directories in afterEach

**Acceptance Criteria**:
- At least 4 integration tests covering add (bare skill), add (plugin with collision), update, and remove
- Tests use real filesystem operations against temp directories
- Tests verify both file-on-disk state and manifest state
- Tests run in the existing test suite (vitest)

**Tests**:
- The integration tests themselves are the deliverable
