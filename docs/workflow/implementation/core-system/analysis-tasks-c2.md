---
topic: core-system
cycle: 2
total_proposed: 6
---
# Analysis Tasks: Core System (Cycle 2)

## Task 1: Extract shared clone-and-reinstall orchestration
status: pending
severity: high
sources: duplication, architecture

**Problem**: The clone-then-nuke-and-reinstall-then-handle-result orchestration is duplicated across 5 call sites in update.ts (runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll), list-update-action.ts (runRemoteUpdate, runLocalUpdate), and list-change-version-action.ts (executeChangeVersionAction). Each site repeats ~60-80 lines of the same structure: buildParsedSourceFromKey, spinner start, cloneSource with try/catch, getSourceDirFromKey, executeNukeAndReinstall with onAgentsDropped callback, 4-way if-chain for NukeReinstallResult statuses, write manifest, cleanupTempDir in finally. The onAgentsDropped warning message is also duplicated verbatim 5 times. Any behavioral change to the pipeline (e.g. adding a new result variant) requires updating all sites.

**Solution**: Extract a shared `cloneAndReinstall` function that encapsulates: (1) buildParsedSourceFromKey, (2) cloneSource with spinner, (3) getSourceDirFromKey, (4) executeNukeAndReinstall with a standard onAgentsDropped handler, (5) NukeReinstallResult status mapping to a discriminated success/failure union, (6) cleanupTempDir in finally. Each call site then maps the shared result to its own return type (ExitSignal for single update, PluginOutcome for batch, UpdateActionResult/ChangeVersionResult for list actions). Place in `src/clone-reinstall.ts` or extend `nuke-reinstall-pipeline.ts`.

**Outcome**: The clone-pipeline-outcome orchestration exists in one place. Adding a new NukeReinstallResult variant requires changes in one location. The agents-dropped warning template is defined once. Each consumer is a thin mapper (~5-10 lines) over the shared result.

**Do**:
1. Create `src/clone-reinstall.ts` with a `cloneAndReinstall` function that accepts: key, entry, projectDir, optional newRef/newCommit, and returns a discriminated union of `{ status: 'success', manifestEntry: ManifestEntry, copiedFiles: string[], droppedAgents: string[] }` or `{ status: 'failed', message: string }`.
2. Move the onAgentsDropped warning template into this module as a helper (e.g., `formatAgentsDroppedWarning`).
3. Encapsulate the full sequence: build parsed source, clone (with spinner), get source dir, execute nuke-and-reinstall, map result statuses, cleanup temp dir in finally.
4. Refactor `runGitUpdate` and `processGitUpdateForAll` in update.ts to call `cloneAndReinstall` and map the result to their existing return types.
5. Refactor `runLocalUpdate` and `processLocalUpdateForAll` in update.ts similarly (local path variant skips clone, uses path directly).
6. Refactor `runRemoteUpdate` and `runLocalUpdate` in list-update-action.ts to use `cloneAndReinstall`.
7. Refactor `executeChangeVersionAction` in list-change-version-action.ts to use `cloneAndReinstall`.
8. Remove the now-unused duplicated code from all call sites.
9. Verify all existing tests pass without modification.

**Acceptance Criteria**:
- The 4-way NukeReinstallResult status handling exists in exactly one location
- The onAgentsDropped warning message template exists in exactly one location
- All update/list-update/list-change-version flows produce identical user-visible output as before
- No call site directly imports or calls cloneSource + executeNukeAndReinstall + cleanupTempDir individually for the update pipeline

**Tests**:
- Existing update command tests pass (single git update, single local update, batch update all)
- Existing list-update-action tests pass (remote update, local update)
- Existing list-change-version-action tests pass
- Each NukeReinstallResult status (no-config, no-agents, invalid-type, copy-failed, success) produces the same error messages/behavior as before

## Task 2: Centralize clone URL derivation and add cloneUrl to GitHubShorthandSource
status: pending
severity: medium
sources: duplication, architecture

**Problem**: Clone URL derivation is implemented independently in three places: `commands/add.ts:33-40` (handles all ParsedSource variants), `update-check.ts:12-17` (constructs `https://github.com/{owner}/{repo}.git` from a manifest key), and `git-clone.ts:29-37` (resolveCloneUrl). The `GitHubShorthandSource` type lacks a `cloneUrl` field, unlike all other git-based ParsedSource variants, forcing every consumer to special-case it with `https://github.com/${owner}/${repo}.git` construction.

**Solution**: (1) Add `cloneUrl: string` to `GitHubShorthandSource` in source-parser.ts, computed as `https://github.com/${owner}/${repo}.git` during parsing. (2) Centralize clone URL resolution into source-parser.ts with two functions: `resolveCloneUrl(parsed: ParsedSource): string` for ParsedSource-based resolution, and `deriveCloneUrlFromKey(key: string, cloneUrl: string | null): string` for manifest-key-based resolution. (3) Remove the independent implementations in add.ts, update-check.ts, and git-clone.ts.

**Outcome**: Clone URL derivation logic exists in one module. All git-based ParsedSource variants carry a `cloneUrl` field, eliminating special-case branches. If the fallback URL template changes, only one location needs updating.

**Do**:
1. In `src/source-parser.ts`, add `cloneUrl: string` to the `GitHubShorthandSource` interface.
2. In the parsing function that creates `GitHubShorthandSource`, compute and set `cloneUrl: \`https://github.com/${owner}/${repo}.git\``.
3. Add a `resolveCloneUrl(parsed: ParsedSource): string` function in source-parser.ts that returns `parsed.cloneUrl` for all git-based variants (now including github-shorthand) and throws for local-path.
4. Add a `deriveCloneUrlFromKey(key: string, cloneUrl: string | null): string` function in source-parser.ts that returns `cloneUrl` if non-null, otherwise constructs from key as `https://github.com/${key}.git`.
5. Replace `deriveCloneUrl` in `commands/add.ts` with the centralized function.
6. Replace `deriveCloneUrl` in `update-check.ts` with `deriveCloneUrlFromKey`.
7. Replace `resolveCloneUrl` in `git-clone.ts` with the centralized function (or import it).
8. Remove the now-unused local implementations.

**Acceptance Criteria**:
- No file outside source-parser.ts contains clone URL construction logic (no `https://github.com/` template strings)
- All ParsedSource git-based variants have a `cloneUrl` field
- All existing tests pass

**Tests**:
- Source parser tests verify GitHubShorthandSource now includes correct cloneUrl
- Add command tests pass with centralized URL derivation
- Update check tests pass with centralized URL derivation
- Git clone tests pass with centralized URL resolution

## Task 3: Fix collection add to enforce per-plugin agent compatibility warnings
status: pending
severity: medium
sources: standards

**Problem**: The collection add flow unions all declared agents across all selected plugins and passes that union to a single `selectAgents` call. This means if plugin A declares `["claude"]` and plugin B declares `["codex"]`, both agents appear without any unsupported warning. The resulting selected agents are applied uniformly to ALL plugins -- plugin A gets installed for codex (which it never declared) and plugin B gets installed for claude (which it never declared). The spec states: "No inheritance -- every installable unit declares its own `agents`, even within collections" and "Agents not listed in the plugin's `agents` field are still shown in the multiselect but display a warning."

**Solution**: During the copy phase for collections, filter each plugin's agents to only include what the user selected AND emit a warning for any selected agent not in that plugin's declared agents list. This preserves the current single-prompt UX while aligning with spec intent. Specifically: after agent multiselect, for each plugin, compute `effectiveAgents = selectedAgents intersect plugin.agents` and `unsupportedSelected = selectedAgents - plugin.agents`. If unsupportedSelected is non-empty, show a warning per the spec. Install each plugin only for its effective agents plus any unsupported agents the user explicitly selected (with the warning shown).

**Outcome**: Each plugin in a collection is installed respecting its own agent declarations. Users see per-plugin warnings when a selected agent is not declared by that plugin.

**Do**:
1. In `src/commands/add.ts`, locate the collection add flow (around line 319-365).
2. After the agent multiselect, iterate over each selected plugin.
3. For each plugin, compare the selected agents against that plugin's `agents` field from its `agntc.json`.
4. For agents selected but not declared by the plugin, emit a warning: "Plugin {plugin-name} does not declare support for {agent}. Installing at your own risk."
5. Install each plugin for ALL selected agents (matching the spec's "warn, never block" approach), but with the warning displayed.
6. Update the agent multiselect to show unsupported warnings based on per-plugin declarations rather than the union.

**Acceptance Criteria**:
- When adding a collection, each plugin shows unsupported-agent warnings based on its own `agents` field, not the union
- The user can still select any agent for any plugin (warn, never block)
- Each plugin's manifest entry `agents` field reflects what was actually installed for that plugin

**Tests**:
- Collection with plugin A (claude-only) and plugin B (codex-only): selecting both agents shows unsupported warnings for each plugin
- Collection where all plugins declare the same agents: no warnings shown
- Single-plugin (non-collection) flow remains unchanged

## Task 4: Extract shared readDirEntries utility
status: pending
severity: medium
sources: duplication

**Problem**: `readSourceAssetDir` in `src/compute-incoming-files.ts:88-95` and `readTopEntries` in `src/copy-plugin-assets.ts:90-97` are near-identical functions. Both read a directory and map entries to `{name: string, isDirectory: boolean}` objects. The interfaces `SourceEntry` and `DirEntry` are structurally identical. Both handle errors by returning an empty array.

**Solution**: Extract a shared `readDirEntries` function into `src/fs-utils.ts` with a single `DirEntry` interface. Both `compute-incoming-files.ts` and `copy-plugin-assets.ts` import from it.

**Outcome**: Directory entry reading logic exists in one place with one interface definition. Both consumers share the same implementation and error handling.

**Do**:
1. Create `src/fs-utils.ts` (or add to an existing utility module if one exists).
2. Define `export interface DirEntry { name: string; isDirectory: boolean }`.
3. Export `readDirEntries(dirPath: string): Promise<DirEntry[]>` that reads the directory with `withFileTypes`, maps to `DirEntry`, and returns `[]` on error.
4. In `src/compute-incoming-files.ts`, replace `readSourceAssetDir` and `SourceEntry` with imports from fs-utils.ts.
5. In `src/copy-plugin-assets.ts`, replace `readTopEntries` and `DirEntry` with imports from fs-utils.ts.
6. Remove the now-unused local implementations and interfaces.

**Acceptance Criteria**:
- `readSourceAssetDir` and `readTopEntries` no longer exist as separate functions
- Both modules import and use the shared `readDirEntries` from fs-utils.ts
- Only one `DirEntry` interface definition exists

**Tests**:
- Existing tests for compute-incoming-files pass
- Existing tests for copy-plugin-assets pass
- readDirEntries returns empty array for non-existent directory
- readDirEntries correctly maps entries with name and isDirectory

## Task 5: Consolidate findDroppedAgents as complement of computeEffectiveAgents
status: pending
severity: medium
sources: architecture

**Problem**: `computeEffectiveAgents` in `src/agent-compat.ts` returns `entryAgents.filter(a => newSet.has(a))` and `findDroppedAgents` returns `entryAgents.filter(a => !newSet.has(a))`. These are logical inverses computed independently. If the effective-agents logic becomes more nuanced, the dropped-agents logic must be updated in lockstep or they will drift. Both are called together in `nuke-reinstall-pipeline.ts` lines 80-87.

**Solution**: Replace the two independent functions with a single function that returns both results: `computeAgentChanges(entryAgents: string[], newConfigAgents: string[]): { effective: string[], dropped: string[] }`. Derive dropped as `entryAgents.filter(a => !effective.includes(a))` so it is always the complement of effective. Alternatively, keep `computeEffectiveAgents` as the primary and derive dropped at the call site.

**Outcome**: Dropped agents are always the exact complement of effective agents by construction, not by independent implementation. The logic cannot drift.

**Do**:
1. In `src/agent-compat.ts`, replace both functions with a single `computeAgentChanges(entryAgents: string[], newConfigAgents: string[]): { effective: string[], dropped: string[] }`.
2. Compute `effective` using the existing logic.
3. Derive `dropped` as `entryAgents.filter(a => !effective.includes(a))`.
4. Update `src/nuke-reinstall-pipeline.ts` (lines 80-87) to destructure the single call: `const { effective, dropped } = computeAgentChanges(...)`.
5. Update any other callers of `computeEffectiveAgents` or `findDroppedAgents`.
6. Remove the old individual exports.

**Acceptance Criteria**:
- `findDroppedAgents` no longer exists as a standalone function
- Dropped agents are derived from effective agents, not computed independently
- All callers updated to use the new unified function

**Tests**:
- Existing agent-compat tests pass (adapted to new function signature)
- nuke-reinstall-pipeline tests pass with identical behavior
- When effective agents change, dropped agents are always the exact complement

## Task 6: Align summary output format with spec
status: pending
severity: low
sources: standards

**Problem**: The spec defines the add summary format as multi-line with per-agent blocks on separate indented lines (e.g., "Claude:\n    12 skills, 3 agents, 2 hooks"). The implementation in `src/summary.ts:63-71` produces a compact single-line format: "Installed owner/repo@ref -- claude: 2 skill(s)". Agent names use lowercase where the spec uses capitalized ("Claude" vs "claude").

**Solution**: Update the summary formatting in `src/summary.ts` to produce multi-line per-agent output with capitalized agent names matching the spec example. Only show asset types that were actually installed (no "0 hooks" lines).

**Outcome**: Summary output matches the spec format: multi-line, per-agent blocks with indentation, capitalized agent names, only non-zero asset types shown.

**Do**:
1. In `src/summary.ts`, locate the summary formatting logic (around line 63-71).
2. Change the output to use multi-line format per the spec:
   ```
   Installed owner/repo@ref

     Claude:
       12 skills, 3 agents, 2 hooks

     Codex:
       12 skills
   ```
3. Capitalize agent names in output (e.g., "Claude" not "claude", "Codex" not "codex").
4. Only include asset types with non-zero counts.
5. For collections, repeat per plugin.

**Acceptance Criteria**:
- Summary output uses multi-line per-agent format matching spec example
- Agent names are capitalized in output
- Zero-count asset types are omitted
- Collection installs show per-plugin summaries

**Tests**:
- Summary for single-agent install shows correct multi-line format
- Summary for multi-agent install shows separate blocks per agent
- Summary omits "0 hooks" or similar zero-count lines
- Agent names appear capitalized in output
