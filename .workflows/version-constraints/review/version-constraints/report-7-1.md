TASK: Fix formatLabel constraint-with-null-ref edge case

ACCEPTANCE CRITERIA:
- formatLabel("owner/repo", { constraint: "^1.0", ref: null, ... }) returns "owner/repo  ^1.0"
- formatLabel("owner/repo", { constraint: "^1.0", ref: "v1.2.3", ... }) still returns "owner/repo  ^1.0 -> v1.2.3"
- All non-constrained label formats unchanged
- New test case covers the constraint-present + ref-null edge case

STATUS: Complete

SPEC CONTEXT: The specification (List Command Integration section) states that constrained plugins should display the constraint alongside the current ref (e.g. "^1.0 -> v1.2.3"). The edge case arises when a constraint is present but no ref has been resolved yet (ref is null), which can occur during constrained-no-match scenarios.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/list.ts:19-30
- Notes: The function correctly checks `entry.constraint` as the outer branch (line 20), then conditionally appends the arrow and ref only when `entry.ref !== null` (line 21-23). When constraint is present but ref is null, it returns `key + "  " + constraint` (line 24). Non-constrained paths (lines 26-29) are unchanged. The restructured conditional cleanly separates the two independent checks as the task required.

TESTS:
- Status: Adequate
- Coverage: All four acceptance criteria are tested:
  - Line 764-784: "shows constraint without arrow when constraint is present but ref is null" -- uses key "owner/repo", constraint "^1.0", ref null, asserts label is "owner/repo  ^1.0"
  - Line 742-762: "shows constraint arrow ref when constraint is present" -- constraint "^1.0", ref "v1.2.3", asserts full arrow format
  - Line 786-806: Non-constrained entry with tag ref shows key@ref (unchanged)
  - Line 808-828: Non-constrained entry with branch ref shows key@branch (unchanged)
  - Line 830-850: Non-constrained entry with null ref shows just key (unchanged)
  - Line 698-718: key@ref when ref is set (unchanged)
  - Line 720-740: just key when ref is null (unchanged)
- Notes: Tests are integration-level (testing through runListLoop by inspecting the options passed to p.select), which provides good confidence that the formatting actually reaches the UI. The edge case test at line 764 directly matches the task's required test case. No over-testing detected -- each test covers a distinct branch path of formatLabel.

CODE QUALITY:
- Project conventions: Followed
- SOLID principles: Good -- formatLabel has single responsibility (label formatting), clean separation of concerns
- Complexity: Low -- three clear conditional branches with early returns, easy to trace
- Modern idioms: Yes -- uses Unicode arrow character directly, clean ternary-free logic
- Readability: Good -- the nested if structure clearly communicates the priority: constraint check first, then ref check within it, then non-constrained fallbacks
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
