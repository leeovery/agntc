TASK: Exact tag and branch ref preserve existing behavior

ACCEPTANCE CRITERIA:
- add owner/repo@v1.2.3 produces manifest entry with ref: "v1.2.3", no constraint
- add owner/repo@main produces manifest entry with ref: "main", no constraint
- Re-add from constrained to exact tag removes constraint
- Re-add from constrained to branch removes constraint
- No ls-remote call for exact tag or branch ref adds
- cloneSource receives parsed.ref as-is

STATUS: Complete

SPEC CONTEXT:
The spec states: "agntc add owner/repo@v1.2.3 means exact pin -- no constraint applied. If you typed a specific version, you meant it." Re-add behavior: "The existing manifest entry is overwritten via the standard nuke-and-reinstall -- the new constraint, ref, and commit values replace the old ones entirely." The resolution order (items 4-5) places exact tag and branch ref after constraint paths, confirming they should skip constraint resolution entirely.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/add.ts:45-81 (resolveTagConstraint function), lines 299-307 (manifest entry construction)
- Notes:
  - Guard conditions in resolveTagConstraint correctly skip both resolution paths for exact tag/branch cases:
    - Bare add guard (line 52-56): requires `ref === null && constraint === null` -- exact tags/branches have `ref !== null`, so this is skipped
    - Explicit constraint guard (line 67): requires `constraint != null` -- exact tags/branches have `constraint === null`, so this is skipped
  - Manifest entry construction (line 306) uses spread with conditional: `...(resolvedConstraint != null && { constraint: resolvedConstraint })` -- when resolvedConstraint is undefined (exact tag/branch case), the constraint key is not added to the entry object
  - Re-add is handled by the full entry replacement via `addEntry` (line 308) which overwrites the entire old entry, naturally removing any previous constraint
  - cloneSource (line 158) receives the parsed object directly, with ref set to the exact tag/branch value
  - No ls-remote call occurs because resolveTagConstraint returns immediately without calling fetchRemoteTags when both guards fail
  - Collection path (lines 589-597) uses the same pattern: `...(constraint != null && { constraint })`, so exact tag/branch collections also omit constraint correctly

TESTS:
- Status: Adequate
- Coverage:
  - "exact tag add produces manifest entry without constraint" (line 3501) -- verifies ref is "v1.2.3" and constraint key is absent
  - "branch ref add produces manifest entry without constraint" (line 3512) -- verifies ref is "main" and constraint key is absent
  - "exact tag add does not call ls-remote" (line 3523) -- verifies fetchRemoteTags, resolveLatestVersion, resolveVersion are NOT called
  - "branch ref add does not call ls-remote" (line 3533) -- same negative assertions
  - "re-add from constrained to exact tag removes constraint" (line 3543) -- sets up existing entry with constraint "^1.0", re-adds with @v1.2.3, verifies nuke of old files and new entry has no constraint
  - "re-add from constrained to branch removes constraint" (line 3573) -- same pattern with branch ref "main"
  - "re-add from constrained to bare add applies new constraint" (line 3603) -- verifies old constraint is replaced (not merged) with fresh ^2.0.0 from bare-add resolution
  - "cloneSource receives exact tag ref directly" (line 3648) -- verifies cloneSource called with ref "v1.2.3" and constraint null
- Notes:
  - All 8 planned tests are present and match the acceptance criteria
  - Tests use `expect("constraint" in entry).toBe(false)` which correctly verifies the key is absent from the object (not just undefined), matching the spec requirement
  - The re-add tests properly set up existing manifest entries with constraint and verify nuke-and-reinstall behavior
  - Collection tests at lines 3770-3811 provide additional coverage for exact tag and branch ref on collections (no constraint on any plugin)

CODE QUALITY:
- Project conventions: Followed -- uses vi.mock pattern consistent with other test files, mocks at module boundary
- SOLID principles: Good -- resolveTagConstraint is a focused function with clear guard conditions; single responsibility for constraint resolution
- Complexity: Low -- guard conditions are simple null checks, no nested logic
- Modern idioms: Yes -- spread with conditional (`...(cond && { key: val })`) is idiomatic for optional object keys
- Readability: Good -- the guard conditions are clearly commented ("Bare add" vs "Explicit constraint"); test names are descriptive and self-documenting
- Issues: Minor -- the default `PARSED` constant (line 177) omits the `constraint` field despite being typed as `ParsedSource` which requires it. This is a pre-existing type issue (not introduced by this task) and does not affect runtime behavior since mocks bypass TypeScript enforcement at runtime and the missing field evaluates to `undefined` which has the same effect as `null` in the guard conditions for this specific case (ref is non-null so the bare-add guard fails on the ref check first).

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The default `PARSED` constant at tests/commands/add.test.ts:177 should include `constraint: null` for type correctness, matching the pattern used in `EXACT_TAG_PARSED` and `BRANCH_REF_PARSED`. This is a pre-existing issue, not introduced by this task.
