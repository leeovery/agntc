TASK: Extract shared out-of-constraint predicate to update-check.ts

ACCEPTANCE CRITERIA:
- hasOutOfConstraintVersion is exported from src/update-check.ts
- Neither update.ts nor list-detail.ts contains inline status-matching logic for the out-of-constraint check
- Both call sites use the shared predicate
- All existing tests pass unchanged

STATUS: Complete

SPEC CONTEXT: The specification defines out-of-constraint detection (section "Out-of-Constraint Detection") as checking whether newer versions exist outside constraint bounds after resolving the best tag. This check runs for every constrained plugin during `update` and `list`. The predicate encapsulates the compound condition: result has status "constrained-update-available" or "constrained-up-to-date" AND latestOverall is not null.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-check.ts:21-34 (ConstrainedWithLatest type + hasOutOfConstraintVersion function)
- Call site 1: src/commands/update.ts:104 (extractOutOfConstraint calls hasOutOfConstraintVersion)
- Call site 2: src/commands/list-detail.ts:145 (renderDetailView calls hasOutOfConstraintVersion)
- Notes: Implementation is clean. The `ConstrainedWithLatest` helper type uses `Extract<>` plus intersection to narrow `latestOverall` from `string | null` to `string`, providing proper type narrowing at call sites. No inline compound conditions for the out-of-constraint check remain in either update.ts or list-detail.ts. The remaining references to "constrained-update-available" and "constrained-up-to-date" in both files (update.ts switch/case for routing logic; list-detail.ts getActions switch/case) are discriminated union branches for different purposes (update flow control, action menu assembly) and are not the out-of-constraint predicate.

TESTS:
- Status: Adequate
- Coverage: tests/has-out-of-constraint-version.test.ts covers all 8 UpdateCheckResult status variants:
  - True: constrained-update-available with non-null latestOverall, constrained-up-to-date with non-null latestOverall
  - False: constrained-update-available with null latestOverall, constrained-up-to-date with null latestOverall
  - False: up-to-date, update-available, local, check-failed, constrained-no-match, newer-tags
- Notes: Tests are focused and necessary -- one test per logical branch, no redundancy. Each test constructs a well-formed UpdateCheckResult variant. The test would fail if the predicate logic broke. Grep verification confirms no inline compound out-of-constraint condition remains in the command files.

CODE QUALITY:
- Project conventions: Followed. Uses `type` keyword for type aliases, proper TypeScript discriminated union patterns per project skills guidance, uses `.js` extension in imports.
- SOLID principles: Good. Single responsibility -- the predicate does one thing. Open/closed -- the predicate can be consumed anywhere without modifying update-check.ts. Dependency inversion -- both commands depend on the abstraction (the predicate) rather than reimplementing the condition.
- Complexity: Low. The predicate is a single compound boolean expression.
- Modern idioms: Yes. Uses `Extract<>` utility type with intersection for precise type narrowing, which is idiomatic advanced TypeScript per project skills (type-guards.md reference). The `result is ConstrainedWithLatest` return type provides proper type narrowing at call sites.
- Readability: Good. Function name clearly communicates intent. The helper type name `ConstrainedWithLatest` is descriptive. The predicate is co-located with `UpdateCheckResult` type definition, making it easy to discover.
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
