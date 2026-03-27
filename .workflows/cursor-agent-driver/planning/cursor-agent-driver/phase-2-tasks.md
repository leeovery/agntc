---
phase: 2
phase_name: Collection Pipeline Silent Skip for Undeclared Agents
total: 2
---

## cursor-agent-driver-2-1 | approved

### Task 1: Per-Plugin Agent Filtering in Collection Pipeline

**Problem**: The collection pipeline in `runCollectionPipeline` (`src/commands/add.ts`) currently passes the full `selectedAgents` array (and the corresponding `agents` driver list) to every plugin's copy operation, regardless of what each plugin actually declares. It also writes `agents: selectedAgents` to the manifest for every plugin. This means plugins get files copied for agents they never declared support for. A warning is logged ("does not declare support for ... Installing at your own risk") but installation proceeds anyway. The spec says this warn-and-install-anyway model is wrong — the correct behavior is to skip agents a plugin does not declare.

**Solution**: Replace the warn-and-install-anyway block (lines 432-442 of `src/commands/add.ts`) with per-plugin agent filtering. Before each plugin's conflict check and copy operation, compute the intersection of `selectedAgents` with that plugin's `declaredAgents`. Build the `agents` (AgentWithDriver[]) array from this intersection, not from the full `selectedAgents`. Write only the intersection to the manifest entry's `agents` field. Add an `agents` field to `PluginInstallResult` so the summary and manifest write sections can use per-plugin agents instead of the global `selectedAgents`.

**Outcome**: Each plugin in a collection only gets files copied for agents it actually declares. The manifest entry for each plugin records only the agents it was installed for. The "does not declare support for" warning code is completely removed. The union-based `selectAgents` call remains unchanged (it already correctly shows the union of all plugins' declared agents).

**Do**:
1. In `src/commands/add.ts`, remove the "4a. Per-plugin agent compatibility warnings" block (lines 432-442) that iterates `pluginConfigs` and logs warnings for undeclared agents.
2. Remove the line that builds the global `agents` array from `selectedAgents` (line 444-447: `const agents = selectedAgents.map(...)`) — this will move inside the per-plugin loop.
3. Add an `agents` field of type `AgentId[]` to the `PluginInstallResult` interface (line 347-354).
4. In the per-plugin conflict-check loop (section 5a, starting at line 461), after retrieving `pluginConfig` for each plugin, compute `pluginAgents`: filter `selectedAgents` to only those present in `pluginConfig.agents`. Build the per-plugin `agents` (AgentWithDriver[]) array from `pluginAgents` using `getDriver()`. Pass this per-plugin `agents` to `computeIncomingFiles` instead of the global `agents`.
5. Store the per-plugin `agents` array in `pluginsToInstall` entries (add an `agents` field of type `AgentWithDriver[]` and a `pluginAgentIds` field of type `AgentId[]` to the `pluginsToInstall` element type).
6. In the copy loop (section 5b, starting at line 537), use the per-plugin `agents` from `pluginsToInstall` instead of the global `agents` when calling `copyPluginAssets` and `copyBareSkill`. Include `agents: pluginAgentIds` in each `PluginInstallResult` pushed to `results`.
7. In the manifest write loop (section 6, starting at line 580), change `agents: selectedAgents` to `agents: result.agents` (using the per-plugin agents from the result).
8. In `renderCollectionAddSummary` in `src/summary.ts`, update the per-plugin summary to use the plugin's own agents rather than `input.selectedAgents`. Add an `agents` field (type `AgentId[]`) to the `CollectionPluginResult` interface, and pass `r.agents` instead of `input.selectedAgents` to `formatPluginSummary` and `formatBareSkillSummary`. The `selectedAgents` field on `CollectionAddSummaryInput` can remain for backward compat or be removed if nothing else uses it.
9. Update existing tests in `tests/commands/add.test.ts` in the "per-plugin agent compatibility warnings" describe block:
   - Replace the "shows unsupported warning" tests with tests verifying per-plugin agent filtering behavior.
   - The test "installs all selected agents for each plugin regardless of warnings" must be rewritten: pluginA (declares claude only) should only receive `agents: [{id: "claude", ...}]`, and pluginB (declares codex only) should only receive `agents: [{id: "codex", ...}]`.
   - The test "manifest agents field includes all selected agents for each plugin" must be rewritten: pluginA's manifest entry should have `agents: ["claude"]`, pluginB's should have `agents: ["codex"]`.
   - The test "no warnings when all plugins declare the same agents as selected" should be updated to verify no filtering occurs (all agents pass through).

**Acceptance Criteria**:
- [ ] The "does not declare support for ... Installing at your own risk" warning code is completely removed from `runCollectionPipeline`
- [ ] Each plugin's copy operation receives only the agents that are in the intersection of `selectedAgents` and that plugin's `declaredAgents`
- [ ] Each plugin's manifest entry records only the agents it was actually installed for (intersection), not the full `selectedAgents`
- [ ] `computeIncomingFiles` receives per-plugin filtered agents, so conflict checks are accurate to what will actually be copied
- [ ] The `selectAgents` call still uses the union of all declared agents (existing behavior preserved)
- [ ] `renderCollectionAddSummary` uses per-plugin agents for each plugin's summary block
- [ ] All existing collection pipeline tests pass (updated where they previously asserted warn-and-install-anyway behavior)

**Tests**:
- `"filters selectedAgents to plugin's declared agents before copy — pluginA (claude-only) receives only claude driver"`
- `"filters selectedAgents to plugin's declared agents before copy — pluginB (codex-only) receives only codex driver"`
- `"manifest entry for each plugin records only its applicable agents"`
- `"no 'does not declare support' warnings are logged"`
- `"plugin declaring exact same agents as selected receives all agents (no-op filter)"`
- `"all plugins declaring identical agents behaves like unfiltered code"`
- `"computeIncomingFiles receives per-plugin filtered agents for accurate conflict checks"`
- `"selectAgents still called with union of all declared agents across plugins"`

**Edge Cases**:
- Plugin declares exact same agents as selected: the filter is a no-op, all selected agents pass through. Copy and manifest behavior is identical to current (pre-change) code for that plugin.
- All plugins declare identical agents: every plugin receives the same filtered set. Behaves like current code minus the warning block — functionally identical except no warnings are logged.

**Context**:
> The spec states: "When iterating plugins in the collection pipeline, filter `selectedAgents` to only those declared by each specific plugin before copying. No warning, no 'at your own risk' — just don't copy files for agents the plugin doesn't support. The manifest entry for each plugin records only the agents it was actually installed for."
>
> The current warning block is at lines 432-442 of `src/commands/add.ts`. The global `agents` array is built at line 444. These both need to be replaced with per-plugin logic.
>
> The `PluginInstallResult` interface (line 347-354) currently has no `agents` field. It needs one so the manifest write loop and summary renderer can use per-plugin agents.
>
> The `pluginsToInstall` array (line 454-459) currently stores `pluginName`, `pluginDir`, `pluginDetected`, and `pluginManifestKey`. It needs to also store the per-plugin `agents` (AgentWithDriver[]) and `pluginAgentIds` (AgentId[]) so the copy loop can use them.

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — "Collection Pipeline: Silent Skip for Undeclared Agents" section

## cursor-agent-driver-2-2 | approved

### Task 2: Silent Skip for Plugins With Zero Applicable Agents

**Problem**: After Task 1 introduces per-plugin agent filtering, a plugin may end up with zero applicable agents (none of the user's selected agents match its declarations). Currently, such a plugin would still go through conflict checks, attempt copy with an empty agents list (producing zero files), and potentially get a manifest entry with an empty agents array. The spec requires that plugins with zero applicable agents be silently skipped — no manifest entry, no copy, no summary line.

**Solution**: After computing the per-plugin agent intersection (from Task 1), check if the resulting array is empty. If so, skip that plugin entirely — do not add it to `pluginsToInstall`, do not run conflict checks for it, do not push any `PluginInstallResult` to `results`. The plugin simply does not appear in the output. This is distinct from the existing "skipped" status (which is for config errors, not-agntc detection, etc.) — a zero-match plugin produces no trace at all.

**Outcome**: A collection containing plugins that target different agents (e.g., pluginA targets claude, pluginB targets codex) installs only the relevant plugins when the user selects a subset of agents. Zero-match plugins leave no manifest entry, produce no copied files, and do not appear in the summary. If ALL plugins in a collection have zero match, nothing installs but no error is thrown — the summary simply shows zero installed plugins.

**Do**:
1. In the per-plugin conflict-check loop in `src/commands/add.ts` (section 5a), after computing `pluginAgents` (the intersection of `selectedAgents` and `pluginConfig.agents`), add an early-continue check: if `pluginAgents.length === 0`, use `continue` to skip to the next plugin. Do NOT push a result to `results` and do NOT add to `pluginsToInstall`. This means the plugin is invisible in the output.
2. Ensure the code handles the case where ALL plugins are filtered out (zero `pluginsToInstall` entries): the copy loop runs zero iterations, the manifest write loop adds zero entries, and the summary shows zero installed plugins. The existing `writeManifest` call should still execute (writing the unchanged manifest is fine). The `renderCollectionAddSummary` should handle zero `installed` results gracefully — verify it does by checking the function in `src/summary.ts`.
3. Verify that `renderCollectionAddSummary` handles zero installed plugins: review the function. It already works with an empty `installed` array (the `pluginBlocks` will be empty, `statusParts` may be empty too). The output would be `"Installed owner/my-collection@main"` with no plugin blocks. This is acceptable — no additional summary changes needed.
4. Write new tests in `tests/commands/add.test.ts` in a new describe block (e.g., `"silent skip for zero-match agent plugins"`) covering the scenarios below.

**Acceptance Criteria**:
- [ ] A plugin with zero applicable agents after filtering is not added to `pluginsToInstall` and no result is pushed for it
- [ ] No manifest entry is created for a zero-match plugin
- [ ] No files are copied for a zero-match plugin
- [ ] No summary line appears for a zero-match plugin (neither in installed nor skipped sections)
- [ ] When ALL plugins in a collection have zero match, the command completes without error — summary shows collection header but no plugin blocks
- [ ] The skip is silent — no warning, no log message for zero-match plugins

**Tests**:
- `"plugin with zero applicable agents is silently skipped — no copy, no manifest entry"`
- `"zero-match plugin does not appear in summary output"`
- `"all plugins in collection have zero match — nothing installs but no error thrown"`
- `"all plugins zero match — summary shows collection header with no plugin blocks and no skipped/failed status"`
- `"single-plugin collection with zero match — no error, empty install"`
- `"mix of installable and zero-match plugins — only installable plugins get manifest entries and summary lines"`
- `"zero-match skip does not log any warning"`

**Edge Cases**:
- All plugins in a collection have zero match (user selects claude, all plugins declare codex only): nothing installs, `writeManifest` is called with the unchanged manifest, `renderCollectionAddSummary` receives zero installed results. The command exits normally (exit code 0 via `p.outro`) — NOT via `ExitSignal`. This is distinct from "no valid plugins" (which throws `ExitSignal(0)` with a warning) because plugins are valid; they just don't match the selected agents.
- Single-plugin collection with zero match: same behavior as above but only one plugin. The command completes with the collection summary header and no plugin blocks.
- Mix of installable and zero-match plugins in the same collection: installable plugins proceed normally (copy, manifest, summary). Zero-match plugins are invisible. The summary only shows installed plugins.

**Context**:
> The spec states: "If a plugin has zero applicable agents after filtering (none of the user's selected agents match its declarations), silently skip that plugin — no manifest entry, no copy, no summary line. This is expected when a collection contains plugins targeting different agents."
>
> This task depends on Task 1's per-plugin agent filtering being in place. The zero-match check is an early-continue in the same loop where per-plugin agents are computed.
>
> The existing "skipped" status in `PluginInstallResult` is used for config errors, missing agntc.json, not-agntc detection, and nuke failures. Zero-match plugins should NOT use the "skipped" status because that would make them appear in the summary's "N skipped" count. Instead, they should simply not appear in the results array at all.
>
> `renderCollectionAddSummary` in `src/summary.ts` (line 118-146) already handles empty `installed` arrays gracefully — it will produce `"Installed owner/my-collection@main"` with no plugin blocks and no status suffix. No changes needed to the summary renderer.

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — "Collection Pipeline: Silent Skip for Undeclared Agents" section
