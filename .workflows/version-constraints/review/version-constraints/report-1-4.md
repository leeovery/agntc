TASK: Validate constraint expressions at parse time

ACCEPTANCE CRITERIA:
- parseSource("owner/repo@^abc") throws with message containing "invalid version constraint"
- parseSource("owner/repo@^1.2.3.4") throws with message containing "invalid version constraint"
- parseSource("owner/repo@^") throws with message containing "invalid version constraint"
- parseSource("owner/repo@~") throws with message containing "invalid version constraint"
- parseSource("owner/repo@^1") succeeds with constraint: "^1"
- parseSource("owner/repo@^1.2") succeeds with constraint: "^1.2"
- parseSource("owner/repo@~1") succeeds with constraint: "~1"
- parseSource("owner/repo@~1.2.3") succeeds with constraint: "~1.2.3"
- parseSource("owner/repo@^0.2.3") succeeds (pre-1.0 is valid semver)
- Validation applies to all three remote source types
- All existing tests pass

STATUS: Complete

SPEC CONTEXT: The specification (section "Constraint Validation") states: "The parser will validate the constraint expression after extracting it. If the version portion is not valid semver (as determined by semver.validRange()), reject at parse time with a clear error message. Examples of invalid input: @^abc, @^, @~, @^1.2.3.4."

IMPLEMENTATION:
- Status: Implemented
- Location: src/source-parser.ts:4 (import of validRange from semver), src/source-parser.ts:97-99 (validation call site in parseSource), src/source-parser.ts:328-332 (validateConstraint function)
- Notes: The implementation is exactly as specified. validRange() from the semver package is used. The validation runs centrally in parseSource after all sub-parsers return, so it applies to all three remote source types (GitHub shorthand, HTTPS URL, SSH URL). The error message format is "invalid version constraint: {constraint}". Local-path and direct-path sources have constraint typed as literal null, so validation is never triggered for them. No drift from plan.

TESTS:
- Status: Adequate
- Coverage: All 13 required tests are present in tests/source-parser.test.ts:
  - Rejection tests: ^abc (line 652), ^1.2.3.4 (line 658), bare ^ (line 553), bare ~ (line 559)
  - Success tests: ^1 (line 664), ^1.2 (line 670), ^1.2.3 (line 676), ~1 (line 682), ~1.2 (line 688), ~1.2.3 (line 694), ^0.2.3 (line 700)
  - Cross-source-type tests: HTTPS with invalid constraint (line 706), SSH with invalid constraint (line 712)
- Notes: Tests are well-balanced. Rejection tests verify the exact error message. Success tests verify both that constraint is set and ref is null. Cross-source-type tests confirm validation applies to HTTPS and SSH, not just GitHub shorthand. No over-testing -- each test covers a distinct case. The bare operator tests (^ and ~) are placed within the GitHub shorthand constraint describe block (lines 553-563), while the remaining validation tests have their own "constraint validation" describe block (lines 651-717). This organization is reasonable since bare operators were detected during shorthand parsing but are validated centrally.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing codebase patterns (async functions, error throwing style, TypeScript strict types)
- SOLID principles: Good -- validateConstraint is a single-purpose function; validation is separated from parsing logic; the central validation point in parseSource follows open/closed principle (new source types auto-inherit validation)
- Complexity: Low -- the validateConstraint function is 3 lines, trivially clear
- Modern idioms: Yes -- uses named import from semver, clean null-check pattern
- Readability: Good -- function name is self-documenting, error message is descriptive and includes the offending constraint value
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
