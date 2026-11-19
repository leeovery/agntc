---
scope: version-constraints
cycle: 1
source: review
total_proposed: 1
gate_mode: auto
---
# Review Tasks: Version Constraints (Cycle 1)

## Task 1: Fix formatLabel constraint-with-null-ref edge case
status: approved
severity: high
sources: report-4-1, report.md

**Problem**: `formatLabel` in `src/commands/list.ts:19-27` uses the condition `entry.constraint && entry.ref !== null` on line 20, which conflates two independent checks. When `entry.constraint` is truthy but `entry.ref` is null, execution falls through to the final `return key` branch, silently dropping the constraint display. The user sees just the key with no indication that a constraint is active.

**Solution**: Restructure the conditional to check `entry.constraint` first as the outer branch, then conditionally append the arrow and ref only when `entry.ref` is non-null. When constraint is present but ref is null, return `key  {constraint}` without the arrow portion.

**Outcome**: `formatLabel` correctly displays the constraint expression for all constrained entries regardless of whether ref is present, and a test guards against regression.

**Do**:
1. In `src/commands/list.ts`, restructure `formatLabel` (lines 19-27):
   - First check `entry.constraint`. If truthy and `entry.ref !== null`, return `` `${key}  ${entry.constraint} \u2192 ${entry.ref}` `` (existing behavior).
   - If truthy and `entry.ref` is null, return `` `${key}  ${entry.constraint}` ``.
   - Otherwise fall through to existing non-constrained logic.
2. In `tests/commands/list.test.ts`, add a test case in the constrained label formatting section:
   - Create a manifest entry with `constraint: "^1.0"` and `ref: null`.
   - Assert the select option label shows `owner/repo  ^1.0` (no arrow, no ref).

**Acceptance Criteria**:
- `formatLabel("owner/repo", { constraint: "^1.0", ref: null, ... })` returns `"owner/repo  ^1.0"`
- `formatLabel("owner/repo", { constraint: "^1.0", ref: "v1.2.3", ... })` still returns `"owner/repo  ^1.0 -> v1.2.3"`
- All non-constrained label formats unchanged
- New test case covers the constraint-present + ref-null edge case

**Tests**:
- Add test: "constrained entry with null ref shows constraint without arrow" -- manifest entry with `constraint: "^1.0"`, `ref: null`, assert label is `"owner/repo  ^1.0"`
