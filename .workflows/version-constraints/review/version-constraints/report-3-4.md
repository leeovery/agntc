TASK: Batch update with mixed constrained and unconstrained plugins

ACCEPTANCE CRITERIA:
- Batch with all constrained plugins processes correctly
- Batch with no constrained plugins (pure backward compat) behaves identically to pre-feature
- Mix of constrained + branch-tracking + tag-pinned + local plugins all process correctly
- Per-plugin results show correct status for each type
- Out-of-constraint info collected from all constrained plugins for output rendering

STATUS: Complete

SPEC CONTEXT: The spec defines update routing based on the presence/absence of the `constraint` field in ManifestEntry. Constrained entries resolve via `maxSatisfying` against remote tags; unconstrained entries follow existing logic (branch HEAD tracking, exact tag pinning, local refresh). Batch update (`agntc update` with no key) must handle both types in a single run. Out-of-constraint info is collated at the end of output, after all per-plugin results. The spec also states "never downgrade" and that no-match entries should be left untouched.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/update.ts:407-621 (runAllUpdates function)
- Notes: The `runAllUpdates` function properly categorizes all check result statuses including the three new constrained statuses:
  - `constrained-update-available` routed to `constrainedUpdateAvailable` array (line 459-460)
  - `constrained-up-to-date` merged into `upToDate` array (line 462-464) -- correct, these are functionally up-to-date
  - `constrained-no-match` routed to `constrainedNoMatch` array (line 465-467)
  - Constrained updates processed with overrides (newRef/newCommit) at lines 497-518
  - Downgrade prevention via `isAtOrAboveVersion` at line 502
  - Out-of-constraint info collected from ALL checkResults (lines 472-482), not just specific categories
  - `allUpToDate` sentinel correctly includes `constrainedUpdateAvailable.length === 0 && constrainedNoMatch.length === 0` (lines 592-593)
  - `constrainedNoMatch` entries rendered in per-plugin summary with warn level (lines 578-584, 608-611)
  - `renderOutOfConstraintOutput` called at both the all-up-to-date early exit (line 597) and the normal summary path (line 620)

TESTS:
- Status: Adequate
- Coverage:
  - "processes constrained-update-available plugins via nuke-and-reinstall with resolved tag" (line 2633) -- verifies clone called with resolved tag, nuke called, manifest written
  - "adds constrained-up-to-date plugins to up-to-date list" (line 2673) -- verifies no clone, shows up-to-date message
  - "adds constrained-no-match plugins to failed/error list in summary" (line 2695) -- verifies warn log with constraint mention, no clone
  - "handles batch with all constrained plugins -- mixed constrained statuses" (line 2718) -- 3 plugins, one of each constrained status, verifies all 3 appear in summary
  - "handles mix of constrained + branch-tracking + tag-pinned + local plugins" (line 2791) -- 4 plugins covering constrained, branch (update-available), tag-pinned (newer-tags), local; verifies all 4 appear in summary
  - "batch with no constrained plugins behaves identically to pre-feature" (line 2885) -- pure unconstrained batch with update-available + newer-tags, verifies backward compat
  - "collects out-of-constraint info from constrained-update-available results" (line 2935) -- verifies successful update when latestOverall is present
  - "collects out-of-constraint info from constrained-up-to-date results" (line 2971) -- two up-to-date entries, one with latestOverall, one without
  - "never downgrades constrained plugins in batch mode" (line 3008) -- constrained-update-available with older tag, verifies no clone and up-to-date message
  - "constrained-update-available with all constrained-up-to-date does not show all-up-to-date message" (line 3038) -- verifies the allUpToDate guard is correct
  - Out-of-constraint rendering tests at lines 3181-3304 cover batch rendering with single and multiple plugins, and omission when no out-of-constraint versions exist
- Notes: Tests are well-structured and cover all acceptance criteria. Each test focuses on a distinct scenario. The mixed test at line 2791 is particularly valuable as it exercises all four plugin types in a single batch. Tests are not over-testing -- each verifies distinct behavioral combinations.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing command patterns in the codebase
- SOLID principles: Good -- `extractOutOfConstraint` is a focused helper; `processUpdateForAll` handles the reinstall concern; categorization is separate from processing. The switch statement is exhaustive over all `UpdateCheckResult` status variants.
- Complexity: Acceptable -- `runAllUpdates` is a long function (~215 lines) with sequential phases (check, categorize, process, summarize). Each phase is linear and readable. The categorization switch is straightforward. The function could be decomposed further, but the sequential nature makes it readable as-is.
- Modern idioms: Yes -- uses `Promise.all` for parallel checks, spread syntax for arrays, proper TypeScript discriminated union narrowing (line 499 re-checks status before accessing `.tag`/.commit`).
- Readability: Good -- clear section comments ("Categorize", "Process updatable plugins", "Build updated manifest", etc.). Variable names are descriptive. The flow is top-to-bottom with no complex branching.
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The `runAllUpdates` function at 215 lines is approaching the threshold where extraction of sub-phases (e.g., a `categorizeCheckResults` helper, a `buildOutcomes` helper) would improve navigability. This is a pre-existing concern, not introduced by this task.
