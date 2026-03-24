TASK: Show constraint expression in detail view

ACCEPTANCE CRITERIA:
- Detail view displays Constraint: <expression> when the manifest entry has a constraint
- Detail view does not display a constraint line when the manifest entry has no constraint
- All existing tests pass unchanged

STATUS: Complete

SPEC CONTEXT: The specification (section "List Command Integration") states the list dashboard should surface constraint information, showing the constraint alongside the current ref when present (e.g. `^1.0 -> v1.2.3`). The manifest entry has an optional `constraint` field (section "Manifest Storage") whose absence is the signal for no constraint -- no sentinel value.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/list-detail.ts:117-119
- Notes: A conditional block `if (entry.constraint)` inserts a `Constraint: <expression>` info line between the Ref and Commit lines. Placement is logical -- it groups version-related metadata together (Ref, Constraint, Commit). The check uses truthiness which correctly handles both `undefined` (field absent) and empty string, though the latter should never occur given parser validation. Clean, minimal change.

TESTS:
- Status: Adequate
- Coverage:
  - "displays constraint line when entry has constraint" (line 124): verifies `Constraint: ^1.0.0` is logged when `entry.constraint` is set
  - "does not display constraint line when entry has no constraint" (line 132): verifies no `Constraint:` prefixed line appears when constraint is absent, using a filter over all info calls
- Notes: Both acceptance criteria are directly tested. The positive test uses `toHaveBeenCalledWith` for exact match. The negative test correctly scans all info calls rather than checking a specific call index, making it resilient to ordering changes. The factory (`makeEntry`) omits `constraint` by default, so all pre-existing tests naturally exercise the no-constraint path. Test coverage is well-balanced -- not over-tested (no redundant variants), not under-tested (both presence and absence verified).

CODE QUALITY:
- Project conventions: Followed. Uses the same `p.log.info()` pattern as surrounding metadata lines. Consistent with how other optional fields are conditionally displayed.
- SOLID principles: Good. Single responsibility maintained -- `renderDetailView` renders the view, the conditional is a simple display concern.
- Complexity: Low. A single `if` guard with no nesting.
- Modern idioms: Yes. Optional chaining not needed here; truthiness check on an optional string property is idiomatic TypeScript.
- Readability: Good. The three-line addition is self-explanatory and follows the established pattern.
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
