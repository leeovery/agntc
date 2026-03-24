TASK: Constrained label formatting in list view

ACCEPTANCE CRITERIA:
- Constrained entry shows key  ^1.0 -> v1.2.3 format
- Non-constrained entry with tag ref shows key@v1.2.3 (unchanged)
- Non-constrained entry with branch ref shows key@main (unchanged)
- Non-constrained entry with no ref shows key (unchanged)

STATUS: Issues Found

SPEC CONTEXT: The specification (List Command Integration > Display) states: "Show the constraint alongside the current ref when present (e.g. ^1.0 -> v1.2.3)". The ManifestEntry.constraint field is optional (constraint?: string); its absence signals no constraint. The plan's detailed acceptance criteria also include a defensive case for constraint present with null ref.

IMPLEMENTATION:
- Status: Partial
- Location: /Users/leeovery/Code/agntc/src/commands/list.ts:19-27
- Notes: The main happy path (constraint + ref present) and all non-constrained paths work correctly. However, the defensive edge case (constraint present, ref null) is not handled. The current code at line 20 uses `entry.constraint && entry.ref !== null`, which means when constraint is truthy but ref is null, execution falls through to line 23-26, returning just `key` and losing the constraint display entirely. The plan specified a different structure where the constraint check is the outer branch and the ref presence determines only whether the arrow portion is appended. The detail view in list-detail.ts:117-119 correctly shows the Constraint line when present, satisfying that acceptance criterion.

TESTS:
- Status: Under-tested
- Coverage: Tests exist for: constrained entry with ref (line 742), non-constrained with tag ref (line 764), non-constrained with branch ref (line 786), non-constrained with no ref (line 808). Tests are in tests/commands/list.test.ts tested indirectly through runListLoop rather than the plan's suggested tests/list-format.test.ts with an exported function. This is acceptable.
- Notes: Missing test for the defensive edge case: constraint present with null ref. The plan explicitly specified this test case ("formatLabel with constraint and null ref shows constraint only" expecting "owner/repo  ^1.0"). Also missing: tilde constraint test ("formatLabel with tilde constraint shows tilde"). The missing test aligns with the implementation gap -- the defensive edge case is both untested and incorrectly implemented.

CODE QUALITY:
- Project conventions: Followed -- uses existing patterns from the codebase (ManifestEntry type, @clack/prompts, etc.)
- SOLID principles: Good -- formatLabel has a single responsibility
- Complexity: Low -- simple conditional branching
- Modern idioms: Yes -- template literals, unicode escapes
- Readability: Good -- intent is clear for the implemented paths
- Issues: The condition on line 20 (`entry.constraint && entry.ref !== null`) conflates two independent checks into one branch, causing the constraint-with-null-ref case to silently degrade. The plan's structure (check constraint first, then conditionally add ref) is more robust.

BLOCKING ISSUES:
- formatLabel does not handle constraint-present + ref-null edge case. When entry.constraint is truthy but entry.ref is null, the function returns just `key` instead of `key  ^1.0`. This contradicts the plan's detailed acceptance criterion ("Constrained entry with null ref shows key  ^1.0 without arrow or ref") and degrades silently. Fix: restructure the constraint branch to check `entry.constraint` first, then conditionally append the arrow+ref. Location: /Users/leeovery/Code/agntc/src/commands/list.ts:20-22
- Missing test for the constraint-with-null-ref edge case. This should be added to verify the fix above.

NON-BLOCKING NOTES:
- The plan suggested exporting formatLabel and creating a dedicated tests/list-format.test.ts for focused unit tests. The current approach tests indirectly through runListLoop, which works but requires extensive mocking setup for what are essentially pure-function tests. Exporting formatLabel would allow simpler, more targeted tests.
- A tilde constraint test ("~1.2 -> v1.2.5") was specified in the plan but not implemented. While the implementation handles tilde identically to caret (no operator-specific logic), having the test would document the behavior and prevent regressions.
