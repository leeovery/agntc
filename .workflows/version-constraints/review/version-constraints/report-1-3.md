TASK: Detect and extract constraint from source parser

ACCEPTANCE CRITERIA:
- parseSource("owner/repo@^1.0") returns { type: "github-shorthand", constraint: "^1.0", ref: null, ... }
- parseSource("owner/repo@~1.2.3") returns { type: "github-shorthand", constraint: "~1.2.3", ref: null, ... }
- parseSource("owner/repo@v1.0") still returns { constraint: null, ref: "v1.0", ... }
- parseSource("owner/repo@main") still returns { constraint: null, ref: "main", ... }
- parseSource("owner/repo") still returns { constraint: null, ref: null, ... }
- parseSource("https://github.com/owner/repo@^1.0") returns { constraint: "^1.0", ref: null, ... }
- parseSource("https://github.com/owner/repo.git@^1.0") returns { constraint: "^1.0", ref: null, ... }
- parseSource("git@github.com:owner/repo.git@^1.0") returns { constraint: "^1.0", ref: null, ... }
- parseSource("git@github.com:owner/repo@~1.2") returns { constraint: "~1.2", ref: null, ... }
- All pre-existing tests still pass

STATUS: Complete

SPEC CONTEXT: The spec defines that constraint prefixes (^ and ~) are unambiguous -- no git ref starts with ^ or ~. The source parser detects these prefixes in the @ suffix and classifies accordingly: constraint is populated and ref is set to null. For non-constraint suffixes, existing behavior is preserved. Constraints are supported on GitHub shorthand, HTTPS URLs, and SSH URLs. They are not supported on local paths or tree URLs (handled by a separate task vc-1-5).

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/source-parser.ts
  - classifyRefOrConstraint (lines 338-346): central helper that routes rawRef to either {ref, constraint:null} or {ref:null, constraint}
  - isConstraintPrefix (lines 334-336): checks for ^ or ~ prefix
  - parseGitHubShorthand (line 378): calls classifyRefOrConstraint
  - parseHttpsUrl (line 300): calls classifyRefOrConstraint
  - parseSshUrl (line 259): calls classifyRefOrConstraint
  - validateConstraint (lines 328-332): called at line 98 after parsing, validates via semver.validRange()
- Notes: Clean implementation. The classifyRefOrConstraint helper is well-factored -- all three parser functions delegate to it, avoiding duplication. The constraint validation is correctly deferred to a separate task (vc-1-4) but already integrated into the parse flow at line 97-99.

TESTS:
- Status: Adequate
- Coverage:
  - "extracts caret constraint from github shorthand" (line 475) -- ^1.2.3 full version
  - "extracts tilde constraint from github shorthand" (line 488) -- ~1.2.3 full version
  - "extracts partial caret constraint" (line 501) -- ^1 partial
  - "extracts partial tilde constraint" (line 514) -- ~1.2 partial
  - "preserves exact ref when no constraint prefix" (line 527) -- v1.2.3 stays as ref
  - "preserves branch ref when no constraint prefix" (line 540) -- main stays as ref
  - "extracts constraint from HTTPS URL" (line 567) -- ^1.0
  - "extracts constraint from HTTPS URL with .git suffix" (line 580) -- .git@^1.0
  - "extracts constraint from SSH URL with .git suffix" (line 610) -- .git@^1.0
  - "extracts constraint from SSH URL without .git suffix" (line 623) -- @~1.2
  - Additional: "extracts caret constraint from SSH URL without .git suffix" (line 636) -- extra coverage beyond plan
  - Bare operator tests: "rejects bare caret operator" (line 553), "rejects bare tilde operator" (line 559)
  - All pre-existing tests include constraint: null in their assertions (regression protection)
  - All 10 required test names from the task are present
- Notes: Tests are well-structured with full toEqual assertions that verify the entire object shape. Each test verifies both the positive (constraint populated, ref null) and negative (ref populated, constraint null) cases. Edge cases from the plan (partial versions, SSH with .git suffix, HTTPS with .git suffix) are all covered. No over-testing detected -- each test covers a distinct input format or behavior path.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing parser structure
- SOLID principles: Good -- classifyRefOrConstraint follows SRP (single classification responsibility), isConstraintPrefix is a focused predicate. The approach is open/closed friendly: adding new constraint operators would only require updating isConstraintPrefix.
- Complexity: Low -- classifyRefOrConstraint is a simple conditional branch, no cyclomatic complexity concern
- Modern idioms: Yes -- destructuring, const assertions, proper TypeScript discriminated union types
- Readability: Good -- function names are self-documenting (classifyRefOrConstraint, isConstraintPrefix). The flow is clear: extract raw ref -> classify -> populate appropriate field.
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
