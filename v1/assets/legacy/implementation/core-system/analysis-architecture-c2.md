AGENT: architecture
FINDINGS:
- FINDING: Repeated nuke-and-reinstall outcome handling across three call sites
  SEVERITY: high
  FILES: src/commands/update.ts:105-202, src/commands/list-update-action.ts:29-123, src/commands/list-change-version-action.ts:17-139
  DESCRIPTION: The pattern of calling `executeNukeAndReinstall`, then matching on its discriminated union result (`no-config`, `no-agents`, `invalid-type`, `copy-failed`, `success`) with near-identical branching logic is duplicated across `runGitUpdate`, `processGitUpdateForAll`, `runRemoteUpdate` in list-update-action, `runLocalUpdate` in both update.ts and list-update-action.ts, and `executeChangeVersionAction`. Each site reconstructs the same clone-then-pipeline-then-handle-result orchestration with only minor differences in how outcomes are surfaced (throw ExitSignal vs return result object vs return PluginOutcome). This is not just textual duplication -- it is structural duplication of an orchestration layer. Any behavioral change to the update pipeline (e.g. adding a new NukeReinstallResult variant) requires updating 5+ locations. The `executeNukeAndReinstall` pipeline was correctly extracted, but the clone+pipeline+outcome-mapping layer above it was not.
  RECOMMENDATION: Extract a shared higher-order function that takes a `NukeReinstallResult` and an outcome-mapping strategy (e.g. `(result: NukeReinstallResult) => T`), or better, push the clone step into `executeNukeAndReinstall` itself (it already knows about sourceDir) and have callers pass a `ParsedSource` instead of manually cloning. The three contexts (single update with ExitSignal, batch update with PluginOutcome, list-action with result object) can each provide a thin mapper over the unified pipeline result.

- FINDING: `findDroppedAgents` is independently implemented when it is the logical complement of `computeEffectiveAgents`
  SEVERITY: medium
  FILES: src/agent-compat.ts:3-17
  DESCRIPTION: `computeEffectiveAgents` returns `entryAgents.filter(a => newSet.has(a))` and `findDroppedAgents` returns `entryAgents.filter(a => !newSet.has(a))`. These are logical inverses operating on the same inputs. Per the "Compose, Don't Duplicate" principle in code-quality.md, the dropped agents should be derived as `entryAgents - effectiveAgents` rather than running an independent filter that could drift if the effective-agents logic becomes more nuanced. Both are called together in `nuke-reinstall-pipeline.ts` lines 80-87, so one could be derived from the other.
  RECOMMENDATION: Keep `computeEffectiveAgents` as the primary computation. Derive dropped agents as: `const droppedAgents = entryAgents.filter(a => !effectiveAgents.includes(a))` -- or have a single function return both as `{ effective, dropped }` to avoid computing the set twice.

- FINDING: `deriveCloneUrl` logic duplicated between `update-check.ts`, `git-clone.ts`, and `commands/add.ts`
  SEVERITY: medium
  FILES: src/update-check.ts:12-17, src/git-clone.ts:29-37, src/commands/add.ts:33-40
  DESCRIPTION: Three separate functions derive a clone URL from source information by falling back to `https://github.com/${owner}/${repo}.git`. Each uses slightly different input types (manifest key string, ParsedSource discriminated union, or Awaited ReturnType) but the core logic is the same GitHub shorthand expansion. The `update-check.ts:deriveCloneUrl` takes a manifest key and splits on `/`, while `git-clone.ts:resolveCloneUrl` and `add.ts:deriveCloneUrl` operate on `ParsedSource`. If the fallback URL template changes (e.g. to support self-hosted instances), all three must be updated.
  RECOMMENDATION: Centralize clone URL derivation in `source-parser.ts` alongside the existing `buildParsedSourceFromKey`. A single `resolveCloneUrl(parsed: ParsedSource): string` that handles all variants, and a `deriveCloneUrlFromKey(key: string, cloneUrl: string | null): string` that handles the manifest-based lookup, would eliminate the scattered fallback logic.

- FINDING: `GitHubShorthandSource` lacks `cloneUrl` field creating asymmetry in `ParsedSource` union
  SEVERITY: medium
  FILES: src/source-parser.ts:5-11, src/commands/add.ts:33-40, src/git-clone.ts:29-37
  DESCRIPTION: All `ParsedSource` variants except `GitHubShorthandSource` and `LocalPathSource` carry a `cloneUrl` field. This forces every consumer of `ParsedSource` to reconstruct the clone URL from `owner` and `repo` when the type is `github-shorthand`. This happens in `git-clone.ts:resolveCloneUrl` (line 36) and `commands/add.ts:deriveCloneUrl` (line 39). If `GitHubShorthandSource` carried `cloneUrl` like all other git-based variants, these special-case branches would disappear and the union would have a cleaner contract: all git sources have `cloneUrl`, only `local-path` does not.
  RECOMMENDATION: Add `cloneUrl: string` to `GitHubShorthandSource` (computed as `https://github.com/${owner}/${repo}.git` during parsing). Then `resolveCloneUrl` in git-clone.ts becomes a simple property access for all non-local-path variants.

- FINDING: `list` command re-checks updates per detail view iteration without caching
  SEVERITY: low
  FILES: src/commands/list.ts:107-112
  DESCRIPTION: Inside the detail-view inner loop, `checkForUpdate` is called on every iteration (line 112). After an update or change-version action, this is correct to reflect new state. But if the user simply views detail and presses "back", the next iteration re-runs `git ls-remote` before re-rendering, adding network latency to a read-only action. The outer loop (line 75) already fetches all statuses in parallel via `checkAllForUpdates`. The inner loop discards that and re-checks individually.
  RECOMMENDATION: Pass the already-fetched `UpdateCheckResult` into the detail loop and only re-check after a mutating action (update, change-version, remove). This avoids a redundant network call on "back".

SUMMARY: The primary architectural concern is the repeated clone-pipeline-outcome-mapping orchestration across five call sites in the update/list-update/list-change-version commands. Extracting this into a shared layer would significantly reduce the surface area for bugs when the pipeline evolves. Secondary issues are the independently-implemented inverse functions in agent-compat and the scattered clone URL derivation logic.
