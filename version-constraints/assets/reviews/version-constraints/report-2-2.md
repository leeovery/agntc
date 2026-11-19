TASK: Bare add resolves latest semver tag and auto-applies constraint

ACCEPTANCE CRITERIA:
- Bare add on repo with tags v1.0.0, v1.1.0, v2.0.0 installs at v2.0.0 with constraint: "^2.0.0"
- Bare add on repo with no semver tags falls back to HEAD with no constraint
- Bare add on repo where all tags are pre-release falls back to HEAD
- Bare add with mixed non-semver and semver tags resolves only semver tags
- cloneSource receives resolved tag name, not constraint expression
- Manifest entry has constraint: "^X.Y.Z", ref: "vX.Y.Z", correct commit
- Local paths not affected -- bare add ./local still works without constraint

STATUS: Complete

SPEC CONTEXT:
The specification (section "Add Command Behavior > Default Behavior (Bare Add)") requires that `agntc add owner/repo` (no `@` suffix) resolves the latest stable semver tag via `semver.maxSatisfying(cleanedVersions, '*')` and auto-applies a `^X.Y.Z` constraint. Pre-release tags are excluded. If no stable semver tags exist, fall back to HEAD with no constraint (existing behavior). The constraint is derived from the cleaned version (no `v` prefix), while the original tag name is stored in `ref` for git checkout.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/add.ts:40-81 (resolveTagConstraint function), src/commands/add.ts:141-144 (invocation in runAdd), src/commands/add.ts:299-307 (manifest entry construction with constraint spread)
- Notes:
  - The `resolveTagConstraint` function is extracted as a shared helper used by both standalone add and collection pipeline (via CollectionPipelineInput.constraint at line 188/596).
  - Bare add detection condition (`type !== "local-path" && ref === null && constraint === null`) correctly identifies the case per spec.
  - When `resolveLatestVersion` returns non-null, constraint is derived as `^${latest.version}` (cleaned, no `v` prefix) and `parsed.ref` is set to the original tag name.
  - When `resolveLatestVersion` returns null (no semver tags, only pre-release, etc.), no constraint or ref is set -- falls back to HEAD.
  - Manifest entry uses spread `...(resolvedConstraint != null && { constraint: resolvedConstraint })` to conditionally include the constraint, ensuring it is absent (not `undefined`) when not applicable.
  - `cloneSource(parsed)` at line 158 receives the updated parsed object with `ref` set to the tag name (e.g., "v2.0.0"), not the constraint expression.
  - Local paths are guarded by `type !== "local-path"` check, so no tag resolution occurs.
  - All seven acceptance criteria are satisfied by the implementation.

TESTS:
- Status: Adequate
- Coverage:
  - "bare add resolves latest semver tag and auto-applies caret constraint" (line 3118) -- verifies cloneSource gets ref "v2.0.0" and manifest entry has constraint "^2.0.0"
  - "bare add falls back to HEAD when no semver tags exist" (line 3139) -- verifies ref is null, no constraint
  - "bare add falls back to HEAD when only pre-release tags exist" (line 3157) -- verifies pre-release exclusion
  - "bare add ignores non-semver tags" (line 3172) -- verifies resolveLatestVersion called with raw tags, ref stays null when no semver match
  - "bare add with mixed semver and non-semver tags picks highest semver" (line 3194) -- verifies correct resolution through mixed tags
  - "bare add local path skips tag resolution" (line 3217) -- verifies no fetchRemoteTags or resolveLatestVersion calls
  - "bare add stores constraint in manifest entry" (line 3233) -- verifies constraint "^2.0.0", ref "v2.0.0", and commit in manifest entry
  - "bare add clones at resolved tag not constraint expression" (line 3250) -- verifies ref is tag name, not "^2.0.0"
- Notes:
  - All 8 specified tests are present and match the planned test descriptions.
  - Tests are well-structured using a dedicated `setupBareAdd` helper that sets the correct BARE_PARSED fixture (ref: null, constraint: null).
  - Tests use appropriate mock granularity -- mocking fetchRemoteTags and resolveLatestVersion separately rather than testing integration with real semver, which is correct since version-resolve.ts has its own unit tests.
  - Each test checks a distinct scenario; no redundant assertions.
  - Tests verify both the cloneSource call (receives correct parsed.ref) and the addEntry call (receives correct manifest entry), covering both the clone path and persistence path.

CODE QUALITY:
- Project conventions: Followed -- TypeScript strict mode, Vitest test framework, mock-based unit testing pattern consistent with other test files
- SOLID principles: Good -- resolveTagConstraint is extracted as a single-responsibility helper, exported for testability, handles both bare and explicit constraint cases. The TagResolutionResult interface cleanly separates the updated parsed source from the derived constraint.
- Complexity: Low -- resolveTagConstraint has two sequential if-blocks with clear guard conditions. The bare add block and explicit constraint block are mutually exclusive in practice (bare add sets ref, which prevents re-entry; explicit constraint only activates when constraint is non-null).
- Modern idioms: Yes -- uses spread operator for immutable updates (`{ ...updatedParsed, ref: latest.tag }`), conditional spread for manifest entry (`...(resolvedConstraint != null && { constraint })`), async/await throughout.
- Readability: Good -- clear comments documenting each block's purpose, meaningful variable names (derivedConstraint vs updatedParsed.constraint), well-named helper function.
- Issues: None significant.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The `resolveTagConstraint` function performs two sequential if-blocks where the second block (`updatedParsed.constraint != null`) can never be entered from the bare add path (because bare add sets ref but not constraint). This is correct but slightly non-obvious -- the analysis reports noted this as "fragile mutual exclusion" at low risk. A brief inline comment explaining why the second block is only reached for explicit constraints would improve clarity. This has already been noted in analysis-report-c1.md.
- The default PARSED constant in the test file (line 177) lacks an explicit `constraint` property despite `GitHubShorthandSource` requiring it. This works at runtime because the mock return value is not type-checked strictly, but it is technically a type violation. Low priority since it does not affect test correctness.
