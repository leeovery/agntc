TASK: Silent Skip for Plugins With Zero Applicable Agents

ACCEPTANCE CRITERIA:
- [x] A plugin with zero applicable agents is not added to pluginsToInstall and no result is pushed
- [x] No manifest entry is created for a zero-match plugin
- [x] No files are copied for a zero-match plugin
- [x] No summary line appears for a zero-match plugin (neither installed nor skipped)
- [x] When ALL plugins have zero match, command completes without error
- [x] The skip is silent -- no warning, no log message

STATUS: Complete

SPEC CONTEXT: The specification ("Collection Pipeline: Silent Skip for Undeclared Agents" section) states: "If a plugin has zero applicable agents after filtering (none of the user's selected agents match its declarations), silently skip that plugin -- no manifest entry, no copy, no summary line. This is expected when a collection contains plugins targeting different agents." The plan further clarifies that zero-match plugins should NOT use the "skipped" status (which would appear in summary counts) but should produce no trace at all, and that when all plugins are zero-match, the command exits normally via p.outro (not via ExitSignal).

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/add.ts:478-481
- Notes: After computing the per-plugin agent intersection (`pluginAgents = selectedAgents.filter(id => declaredSet.has(id))`), the code checks `if (pluginAgents.length === 0) continue;` at line 481. This is placed correctly -- before conflict checks (line 524-540), before `pluginsToInstall.push` (line 542-549), and crucially without pushing any result to `results`. The `continue` skips the entire rest of the loop body for that plugin, which means: no nuke of existing files, no `computeIncomingFiles`, no `runConflictChecks`, no entry in `pluginsToInstall`, and no `PluginInstallResult` pushed. The downstream code (copy loop at 554-601, manifest write at 605-623, summary render at 626-633) all operate only on `pluginsToInstall` and `results`, so a zero-match plugin is completely invisible. The `renderCollectionAddSummary` function (src/summary.ts:118-146) handles empty `installed` arrays gracefully -- it produces the collection header with no plugin blocks. The `writeManifest` call at line 623 still executes (writing unchanged manifest), which is correct per spec.

TESTS:
- Status: Adequate
- Coverage: All 7 planned test scenarios are implemented in a dedicated `describe("silent skip for plugins with zero applicable agents")` block at tests/commands/add.test.ts:1438-1633.
  - "plugin with zero applicable agents is silently skipped -- no copy, no manifest entry" (line 1480): Verifies only pluginA gets copy and manifest entry when pluginB has zero match.
  - "zero-match plugin does not appear in summary output" (line 1505): Verifies pluginB is absent from the outro summary string.
  - "all plugins in collection have zero match -- nothing installs but no error thrown" (line 1524): Uses `resolves.toBeUndefined()` to confirm no ExitSignal.
  - "all plugins zero match -- summary shows collection header with no plugin blocks" (line 1537): Verifies no addEntry calls, writeManifest still called, summary contains collection key but not individual plugin names.
  - "single-plugin collection with zero match -- no error, empty install" (line 1557): Uses separate setup with single-plugin collection. Verifies no copy, no addEntry.
  - "mix of installable and zero-match plugins -- only installable plugins get manifest entries and summary lines" (line 1587): Verifies only pluginA gets copy/manifest/summary, no "skipped" line for pluginB.
  - "zero-match skip does not log any warning" (line 1610): Inspects mockLog.warn calls and filters for any mention of pluginB, zero, or "no agents" -- expects none found.
- Notes: Tests cover the happy path, all-zero-match edge case, single-plugin edge case, mixed scenario, and the silence assertion. The shared `setupZeroMatchCollection` helper (line 1439-1478) reduces duplication while remaining flexible via parameters. Tests verify behavior through assertions on mocked functions (copy, manifest, summary) rather than implementation internals -- they would fail if the feature broke.

CODE QUALITY:
- Project conventions: Followed. Uses the same patterns as the rest of the collection pipeline (vi.mocked, setupCollectionBase pattern, ExitSignal handling). TypeScript types are properly used.
- SOLID principles: Good. The single `continue` statement at line 481 is the minimal intervention point -- it doesn't introduce new abstractions or modify existing interfaces. Single responsibility is maintained.
- Complexity: Low. One additional conditional check (`if (pluginAgents.length === 0) continue;`) adds no cyclomatic complexity worth noting.
- Modern idioms: Yes. Uses Set-based intersection, `continue` for early exit in loops -- standard and clear.
- Readability: Good. The line is self-explanatory in context (immediately follows the comment "Per-plugin agent filtering: intersect selectedAgents with plugin's declared agents"). The intent is clear without additional comments.
- Issues: None.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
