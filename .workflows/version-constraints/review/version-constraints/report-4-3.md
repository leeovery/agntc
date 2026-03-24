TASK: Constraint-aware detail view actions (vc-4-3)

ACCEPTANCE CRITERIA:
- constrained-update-available offers Update action
- constrained-up-to-date with outOfConstraint offers Change version action
- constrained-up-to-date without outOfConstraint shows only Remove/Back
- constrained-no-match shows error info and Remove/Back only
- Non-constrained detail view actions unchanged

STATUS: Complete

SPEC CONTEXT: The list command detail view must surface constraint-aware actions. The spec defines three constrained update statuses (constrained-update-available, constrained-up-to-date, constrained-no-match) with distinct UX behaviors. Out-of-constraint detection uses the "latestOverall" field (absolute latest stable semver tag outside constraint bounds) to determine whether to offer a "Change version" action. The change-version action operates outside the constraint system per spec section "List Command Integration".

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/commands/list-detail.ts:55-108 (getActions), :110-162 (renderDetailView)
- Notes:
  - getActions refactored to accept full UpdateCheckResult (discriminated union) instead of a plain status string, enabling inspection of latestOverall field (line 78)
  - constrained-update-available (line 65-71): offers Update, Change version, Remove, Back
  - constrained-up-to-date with latestOverall (line 77-84): offers Change version, Remove, Back
  - constrained-up-to-date without latestOverall (line 85-88): offers Remove, Back only
  - constrained-no-match (line 96-100): offers Remove, Back only
  - constrained-no-match error message displayed at line 137-141
  - Out-of-constraint info displayed at line 142-148 for both constrained-up-to-date and constrained-update-available
  - All 8 UpdateCheckResult statuses handled exhaustively in the switch
  - Non-constrained statuses (update-available, up-to-date, newer-tags, check-failed, local) unchanged

TESTS:
- Status: Adequate
- Coverage:
  - "actions by status" section (lines 298-488): Tests all 8 status types including the 3 new constrained statuses
  - constrained-update-available: verifies Update, Change version, Remove, Back (line 396-421)
  - constrained-up-to-date with latestOverall: verifies Change version, Remove, Back (line 423-445)
  - constrained-up-to-date without latestOverall: verifies Remove, Back only (line 447-468)
  - constrained-no-match: verifies Remove, Back only (line 470-488)
  - "contextual messages" section (lines 491-585): Tests error/info display for constrained statuses
  - constrained-no-match error message with constraint expression (line 492-505)
  - constrained-up-to-date with/without latestOverall info message (lines 507-543)
  - constrained-update-available with/without latestOverall info message (lines 545-585)
  - Non-constrained status tests preserved and passing (lines 299-394)
  - Edge cases from plan covered: no out-of-constraint (no change-version offered), error info for no-match, non-constrained unchanged
- Notes: Tests are well-structured, focused, and not over-tested. Each test verifies exactly one behavior. The contextual messages tests complement the action tests by verifying the displayed messages are correct.

CODE QUALITY:
- Project conventions: Followed -- uses discriminated union pattern consistent with the codebase, @clack/prompts for UI, vitest for testing
- SOLID principles: Good -- getActions has single responsibility (map status to actions), open/closed via discriminated union switch
- Complexity: Low -- switch statement with clear cases, one conditional (latestOverall check) within constrained-up-to-date
- Modern idioms: Yes -- TypeScript discriminated unions, exhaustive switch, clean separation of display logic from action logic
- Readability: Good -- switch cases are self-documenting, action arrays clearly express the available options per status
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The switch in getActions does not have a default/exhaustive check (e.g., a `default: never` assertion). TypeScript's control flow analysis handles this at the type level since the function's return type is inferred, but an explicit exhaustiveness guard would catch future status additions at compile time. Minor improvement opportunity.
