TASK: Explicit constraint resolves best matching tag

ACCEPTANCE CRITERIA:
- add owner/repo@^1.0 with tags v1.0.0, v1.1.0, v2.0.0 installs at v1.1.0 with constraint "^1.0"
- add owner/repo@~1.0.0 with tags v1.0.0, v1.0.5, v1.1.0 installs at v1.0.5
- add owner/repo@^2.0 with only v1.x tags throws error
- Manifest stores original constraint expression (^1 not ^1.0.0)
- cloneSource receives resolved tag name, not constraint expression
- parsed.ref set to original tag name for git checkout

STATUS: Complete

SPEC CONTEXT: The specification (section "Add Command Behavior > Resolution Order") defines that `agntc add owner/repo@^1` and `@~1.2` are explicit constraint forms. The parser outputs `{ constraint: "^1.0", ref: null }` for these. The add command must fetch tags, resolve the best matching tag via `semver.maxSatisfying`, set `parsed.ref` to the resolved tag for cloning, and store the original constraint expression in the manifest. If no tags satisfy the constraint, throw an error and abort. Constraints are supported on GitHub shorthand, HTTPS, and SSH source types.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/add.ts:45-81 (resolveTagConstraint function), specifically lines 66-77 for the explicit constraint branch
- Notes:
  - The explicit constraint path correctly checks `updatedParsed.constraint != null` (line 67)
  - Fetches remote tags via `fetchRemoteTags(url)` (line 69)
  - Calls `resolveVersion(updatedParsed.constraint, tags)` with the original constraint expression (line 70)
  - Throws descriptive error if no match found (lines 71-74)
  - Sets `parsed.ref` to `resolved.tag` for cloning (line 76)
  - Returns the original constraint from `updatedParsed.constraint` (line 79), preserving the user's expression
  - In `runAdd()`, the manifest entry conditionally includes constraint via spread (line 306): `...(resolvedConstraint != null && { constraint: resolvedConstraint })`
  - Error from `resolveTagConstraint` is caught by `runAdd`'s catch block (lines 323-328) and re-thrown as `ExitSignal(1)`, matching the expected behavior
  - No drift from the planned approach

TESTS:
- Status: Adequate
- Coverage:
  - "explicit caret constraint resolves best matching tag" (line 3283) -- verifies cloneSource gets resolved tag and manifest has constraint
  - "explicit tilde constraint resolves best matching tag" (line 3304) -- verifies tilde variant works identically
  - "no tags satisfy constraint throws error" (line 3328) -- verifies ExitSignal thrown and cloneSource not called
  - "partial constraint resolves against full tags" (line 3344) -- verifies ^1 (partial) resolves correctly
  - "pre-1.0 caret semantics work correctly" (line 3366) -- verifies ^0.2.0 semantics
  - "explicit constraint stores original expression in manifest" (line 3397) -- verifies ^1.0 not normalized to ^1.0.0
  - "explicit constraint on HTTPS URL works" (line 3413) -- verifies HTTPS source type support
  - "explicit constraint on SSH URL works" (line 3441) -- verifies SSH source type support
- All 8 planned test cases are present
- Tests verify both the clone input (parsed.ref) and the manifest output (entry.constraint), covering the full data flow
- Tests use appropriate mocking -- dependencies are mocked, behavior is verified through call assertions
- The underlying `resolveVersion` function has its own dedicated test suite in tests/version-resolve.test.ts with 12 tests covering normalization, constraint resolution, pre-1.0 semantics, empty lists, and mixed tag formats

CODE QUALITY:
- Project conventions: Followed -- uses the established pattern of extracting a helper function (resolveTagConstraint) that is exported for testability, consistent with the codebase style
- SOLID principles: Good -- resolveTagConstraint has a single responsibility (resolve tags based on constraints), the version resolution logic is in a separate module (version-resolve.ts), and the source parsing is cleanly separated
- Complexity: Low -- the explicit constraint branch is a straightforward if-block with clear error handling
- Modern idioms: Yes -- uses spread for immutable updates, nullish coalescing, conditional spread for optional fields
- Readability: Good -- code comments clearly label "Bare add" vs "Explicit constraint" branches; the flow is linear and easy to follow
- Issues: None significant

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The base `PARSED` constant in the test file (line 177) is missing the `constraint` field that `GitHubShorthandSource` requires. This does not affect correctness because all explicit constraint tests override the mock with proper fixtures, but it is technically a type-level inconsistency. The omission works at runtime because vi.mocked does not enforce completeness.
- The `resolveTagConstraint` function calls `fetchRemoteTags` twice when a bare-add resolves to a latest version that also happens to have a constraint (first in the bare-add block, then in the explicit-constraint block). For the explicit constraint case specifically, it is only called once, so this is not relevant to this task but worth noting as context.
