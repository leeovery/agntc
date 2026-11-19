TASK: Collection add propagates constraint to each plugin manifest entry

ACCEPTANCE CRITERIA:
- Bare add owner/collection -- all selected plugins get constraint: "^2.0.0" and ref: "v2.0.0"
- add owner/collection@^1.0 -- all selected plugins get constraint: "^1.0" and ref: "v1.1.0"
- add owner/collection@v1.0.0 -- all plugins get ref: "v1.0.0" with no constraint
- add owner/collection@main -- all plugins get ref: "main" with no constraint
- Bare add with no semver tags falls back to HEAD, no constraint
- Each plugin's manifest entry is independent
- Tag resolution happens exactly once for the collection

STATUS: Complete

SPEC CONTEXT: The spec's "Collection Constraints" section states each plugin installed from a collection is tracked independently with its own constraint, ref, and commit. Bare add auto-applies ^X.Y.Z, explicit constraint propagates to each selected plugin, and exact/branch refs produce no constraint. Tag resolution shares the same repo, so it should happen once.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/add.ts
  - resolveTagConstraint helper: lines 40-81 (shared by both standalone and collection pipelines)
  - CollectionPipelineInput with constraint field: lines 340-348
  - constraint passed to collection pipeline: line 188
  - Collection manifest entry construction with conditional constraint spread: lines 589-597
- Notes: The implementation correctly extracts tag resolution into the shared `resolveTagConstraint` function called once in `runAdd` (line 142) before the collection pipeline is invoked. The resolved constraint flows through `CollectionPipelineInput.constraint` and is applied uniformly to every installed plugin's manifest entry using the pattern `...(constraint != null && { constraint })`. This pattern correctly omits the field entirely when no constraint exists, matching the spec's "absence is the signal" design.

TESTS:
- Status: Adequate
- Coverage:
  - "collection bare add auto-applies same ^X.Y.Z to all selected plugins" (line 3720) -- verifies constraint "^2.0.0" and ref "v2.0.0" on both plugins
  - "collection with explicit constraint propagates to all plugins" (line 3743) -- verifies constraint "^1.0" and ref "v1.1.0" on both plugins
  - "collection with exact tag has no constraint on plugins" (line 3770) -- verifies `"constraint" in entry` is false, ref is "v1.0.0"
  - "collection with branch ref has no constraint on plugins" (line 3792) -- verifies `"constraint" in entry` is false, ref is "main"
  - "collection bare add with no semver tags falls back to HEAD" (line 3814) -- verifies no constraint, ref is null
  - "collection tag resolution happens once not per-plugin" (line 3834) -- verifies fetchRemoteTags called exactly once
  - "collection direct-path add preserves existing behavior" (line 3850) -- verifies no fetchRemoteTags call, no constraint, ref is "main"
  - "each plugin manifest entry is independent" (line 3891) -- verifies different manifest keys and distinct entry objects (bonus test beyond plan)
- Notes: Tests use `"constraint" in entry` for absence checks rather than `=== undefined`, which is the correct approach since the conditional spread pattern means the property literally does not exist on the object. The setup helper `setupCollectionConstraintBase` avoids duplication across tests. All 7 planned tests are present plus one additional independence test. Tests mock at the right level (fetchRemoteTags, resolveLatestVersion, resolveVersion) to verify the integration flow without testing implementation details.

CODE QUALITY:
- Project conventions: Followed -- uses the same conditional spread pattern as the standalone path for consistency
- SOLID principles: Good -- the `resolveTagConstraint` helper follows SRP (single concern: resolve tag and constraint from parsed source), and the collection pipeline follows OCP (adding constraint support required minimal changes to existing flow)
- Complexity: Low -- the constraint propagation is a straightforward pass-through; no new branching in the collection pipeline loop
- Modern idioms: Yes -- spread operator for conditional properties, async/await throughout, proper TypeScript interfaces
- Readability: Good -- the `CollectionPipelineInput` interface clearly documents the constraint field, the destructuring in `runCollectionPipeline` makes the data flow obvious
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The `resolveTagConstraint` function has no direct unit tests; it is tested indirectly through `runAdd` integration tests. This is acceptable given its role as a composition helper, but direct tests could catch regressions faster if the function were refactored.
