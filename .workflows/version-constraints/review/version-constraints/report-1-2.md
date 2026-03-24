TASK: Extend ParsedSource types with constraint field

ACCEPTANCE CRITERIA:
- ParsedSource type includes constraint on every variant
- constraint is typed as string | null on remote sources (github-shorthand, https-url, ssh-url)
- constraint is typed as literal null on direct-path and local-path
- All existing source-parser tests pass after adding constraint: null to expected objects
- All other existing tests pass unchanged (pnpm test)

STATUS: Complete

SPEC CONTEXT: The specification states "ParsedSource will gain an optional constraint field." For non-constrained inputs the field is null. Constraints (^, ~) are supported on remote source types (github-shorthand, https-url, ssh-url). Constraints are not supported on local paths (no remote tags) or tree URLs (already pinned to a specific ref). The parser only classifies user input -- it does not resolve tags or derive constraints.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/source-parser.ts
- Notes:
  - GitHubShorthandSource (line 11): `constraint: string | null` -- correct
  - HttpsUrlSource (line 21): `constraint: string | null` -- correct
  - SshUrlSource (line 31): `constraint: string | null` -- correct
  - DirectPathSource (line 41): `constraint: null` (literal type) -- correct
  - LocalPathSource (line 51): `constraint: null` (literal type) -- correct
  - parseLocalPath (line 132): returns `constraint: null` -- correct
  - parseDirectPath (line 196): returns `constraint: null` -- correct
  - parseSshUrl (line 259-266): uses `classifyRefOrConstraint()` to set constraint -- correct
  - parseHttpsUrl (line 300-307): uses `classifyRefOrConstraint()` to set constraint -- correct
  - parseGitHubShorthand (line 378-385): uses `classifyRefOrConstraint()` to set constraint -- correct
  - buildParsedSourceFromKey (lines 406, 417): both return paths include `constraint: null` -- correct
  - classifyRefOrConstraint helper (line 338-346): correctly routes ^/~ prefixed refs to constraint field, all others to ref field
  - validateConstraint (line 328-332): validates constraint expression via `semver.validRange()`
  - parseSource (line 97-99): validates non-null constraints after parsing -- correct integration point
  - No drift from plan

TESTS:
- Status: Adequate
- Coverage:
  - parseSource('owner/repo') returns constraint: null -- line 29 (covered)
  - parseSource('owner/repo@v2.0') returns constraint: null for exact ref -- line 42 (covered)
  - parseSource('https://github.com/owner/repo') returns constraint: null -- line 144 (covered)
  - parseSource('git@github.com:owner/repo.git') returns constraint: null -- line 314 (covered)
  - parseSource for tree URL returns constraint: null -- line 753 (covered)
  - parseSource for local path returns constraint: null -- line 914 (covered)
  - buildParsedSourceFromKey returns constraint: null -- lines 1059, 1071, 1089, 1102, 1119 (covered)
  - Type-level guarantees: LocalPathSource.constraint typed as literal null (line 1242), DirectPathSource.constraint typed as literal null (line 1249)
  - Constraint detection tests (lines 473-648): extensive coverage of caret/tilde constraints on all remote source types
  - Constraint validation tests (lines 651-716): rejection of invalid constraints, acceptance of valid ones
  - Regression tests (lines 719-741): existing source types still work
  - Edge cases: local path with @^ treated as filesystem path (line 1033), tree URL with constraint-like suffix rejected (lines 880-891)
  - Every toEqual assertion across all source variants includes `constraint: null` or the appropriate constraint value
  - Tests would fail if the feature broke (removing constraint field would break all toEqual assertions)
- Notes: Tests are comprehensive and well-organized. No over-testing detected -- each test verifies a distinct scenario.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing source-parser patterns
- SOLID principles: Good
  - Single responsibility: classifyRefOrConstraint() cleanly separates the ref-vs-constraint classification logic
  - Open/closed: New constraint field was added without modifying existing parsing logic structure
  - The helper function pattern (classifyRefOrConstraint, isConstraintPrefix, validateConstraint) keeps each concern isolated
- Complexity: Low -- the constraint classification is a simple prefix check, validation delegates to semver.validRange()
- Modern idioms: Yes -- uses destructuring for the classifyRefOrConstraint return value, literal null types for compile-time guarantees on non-constraint source types
- Readability: Good -- the constraint integration point in parseSource() (lines 97-99) is clear and centralized
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- Several test files outside source-parser.test.ts construct ParsedSource objects without the constraint field (e.g., tests/commands/add.test.ts:177, tests/commands/add.test.ts:546, tests/git-clone.test.ts:17-25). These don't cause failures because tests/ is excluded from tsconfig.json compilation and the missing field evaluates to undefined which doesn't break the runtime logic paths exercised by those tests. However, this means those test objects don't accurately represent the real ParsedSource shape. This is a pre-existing pattern and outside the scope of this task, but worth noting for future cleanup.
