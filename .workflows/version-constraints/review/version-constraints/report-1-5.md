TASK: Reject constraints on local-path and direct-path sources

ACCEPTANCE CRITERIA:
- parseSource("./my-plugin@^1.0") throws a filesystem error (path does not exist) -- the @^1.0 is part of the path, not parsed as a constraint
- parseSource("https://github.com/owner/repo/tree/main/plugin@^1.0") throws "tree URLs cannot have @ref suffix"
- LocalPathSource.constraint is typed as literal null (compile-time guarantee)
- DirectPathSource.constraint is typed as literal null (compile-time guarantee)
- All existing tests pass

STATUS: Complete

SPEC CONTEXT: The specification (section "Source Type Support") states constraints are not supported on local paths (no remote tags to resolve against) and tree URLs (already pinned to a specific ref). For local paths, the @ character is naturally part of the filesystem path since `isLocalPath()` triggers on `./`, `../`, `/`, `~` prefixes. For tree URLs, the existing `rawPath.includes("@")` check in `parseDirectPath()` already rejects any @ in the path portion, covering both plain refs and constraint-like suffixes.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/source-parser.ts:47 -- `LocalPathSource` interface with `constraint: null` literal type
  - src/source-parser.ts:37 -- `DirectPathSource` interface with `constraint: null` literal type
  - src/source-parser.ts:82 -- `isLocalPath()` check routes `./my-plugin@^1.0` to `parseLocalPath()`, which treats the entire string as a filesystem path
  - src/source-parser.ts:104-135 -- `parseLocalPath()` resolves the path (including the `@^1.0` portion) and calls `stat()`, which fails with a filesystem error
  - src/source-parser.ts:153 -- `rawPath.includes("@")` in `parseDirectPath()` rejects tree URLs with any `@` in the path portion, covering both regular refs and constraint-like suffixes
- Notes: No new production code was needed for this task. The existing code already handles both cases correctly. The task was purely about documenting existing behavior with tests.

TESTS:
- Status: Adequate
- Coverage:
  - tests/source-parser.test.ts:1033 -- "treats @^ in local path as part of filesystem path, not constraint" -- verifies that `./my-plugin@^1.0` throws the filesystem error, confirming the parser does not extract constraints from local paths
  - tests/source-parser.test.ts:880 -- "rejects tree URL with constraint-like caret suffix in path" -- verifies `plugin@^1.0` in a tree URL throws "tree URLs cannot have @ref suffix"
  - tests/source-parser.test.ts:886 -- "rejects tree URL with tilde constraint-like suffix" -- verifies `plugin@~1.2` in a tree URL throws "tree URLs cannot have @ref suffix"
  - tests/source-parser.test.ts:1041 -- "local path with tilde prefix is filesystem tilde expansion, not constraint" -- verifies `~/my-plugin` is treated as a filesystem path with tilde expansion, not a constraint
  - tests/source-parser.test.ts:1242-1247 -- compile-time type test verifying `LocalPathSource.constraint` is literal `null`
  - tests/source-parser.test.ts:1249-1254 -- compile-time type test verifying `DirectPathSource.constraint` is literal `null`
- Notes: All four specified test cases are present. The type-level tests use vitest's `expectTypeOf` which validates at compile time. Tests are focused and not redundant -- each covers a distinct edge case. The tests would fail if the behavior changed (e.g., if someone added constraint extraction to local path parsing, the filesystem error test would no longer throw). Pre-existing tests at line 824 and 846 also cover the general case of `@ref` rejection on tree URLs, providing additional coverage.

CODE QUALITY:
- Project conventions: Followed -- uses vitest patterns, async/await, TypeScript literal types
- SOLID principles: Good -- the `constraint: null` literal types provide compile-time guarantees (interface segregation principle applied well), preventing accidental constraint assignment to source types that don't support them
- Complexity: Low -- no new code added; test cases are straightforward
- Modern idioms: Yes -- uses `expectTypeOf` for compile-time type assertions, which is the idiomatic vitest approach
- Readability: Good -- test descriptions clearly communicate intent; the test names match the acceptance criteria almost verbatim
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
