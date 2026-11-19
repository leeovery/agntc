AGENT: architecture
FINDINGS:
- FINDING: Duplicate ls-remote call in the bare-add flow
  SEVERITY: medium
  FILES: src/commands/add.ts:56-77
  DESCRIPTION: In `resolveTagConstraint`, the bare-add path fetches remote tags via `fetchRemoteTags` to find the latest version (line 58), then when the derived constraint is set on the `updatedParsed` object, the explicit-constraint branch immediately below (line 67) fetches remote tags a second time from the same URL. Both branches are in the same function and could share the tag list. The bare-add case currently avoids the second fetch because `updatedParsed.constraint` remains `null` after the first block -- the constraint is stored in the separate `derivedConstraint` variable. So the double-fetch only occurs for explicit constraints. However, the mutual exclusion between the two blocks relies on the implicit contract that `updatedParsed.constraint` stays null through the bare-add path. This coupling is fragile: if someone refactored to set `updatedParsed.constraint` during the bare-add path, both blocks would fire and fetch tags twice.
  RECOMMENDATION: Restructure with an early return after the bare-add resolution succeeds, or fetch tags once at the function top and pass the list to both branches. This makes the mutual exclusion explicit and eliminates any risk of double fetching.

- FINDING: `resolveTagConstraint` is exported from add.ts but only consumed internally
  SEVERITY: low
  FILES: src/commands/add.ts:45
  DESCRIPTION: `resolveTagConstraint` is exported, expanding the module's public API surface. It is only consumed within `add.ts` by `runAdd`. The export exists to support direct unit testing of the tag resolution logic independently from the full add command pipeline. While pragmatic, this leaks an internal implementation detail into the module boundary.
  RECOMMENDATION: No immediate action required. If the function is directly tested elsewhere the export is justified. Otherwise, making it non-exported would tighten the surface.

SUMMARY: The implementation architecture is sound overall. Module boundaries between version-resolve, update-check, source-parser, and the command layer are clean and well-composed. The discriminated union for `UpdateCheckResult` with the new constrained statuses integrates cleanly with both the update command's batch/single-plugin paths and the list detail view. The `nuke-reinstall-pipeline` correctly preserves constraints through the update flow. Previous cycle findings around the list-update-action missing constrained overrides and the downgrade guard duplication have been addressed -- the list command now forwards `newRef`/`newCommit` for constrained updates, and `isAtOrAboveVersion` is extracted into version-resolve.ts as a shared helper. The remaining findings are low-to-medium severity structural preferences, not latent bugs.
