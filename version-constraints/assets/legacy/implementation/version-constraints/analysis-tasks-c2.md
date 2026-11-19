---
topic: version-constraints
cycle: 2
total_proposed: 1
---
# Analysis Tasks: Version Constraints (Cycle 2)

## Task 1: Extract shared out-of-constraint predicate to update-check.ts
status: pending
severity: medium
sources: duplication

**Problem**: The same compound boolean condition -- checking whether an UpdateCheckResult has status `"constrained-update-available"` or `"constrained-up-to-date"` AND `latestOverall` is not null -- is implemented in two places. In `src/commands/update.ts:103-107` it lives inside `extractOutOfConstraint()` (which also checks `entry.constraint !== undefined`). In `src/commands/list-detail.ts:142-145` it is an inline conditional that omits the `entry.constraint` check. The two guards serve the same semantic ("does this constrained plugin have a newer version outside its constraint bounds?") but diverge slightly and will drift further independently.

**Solution**: Extract a type-narrowing predicate function (e.g. `hasOutOfConstraintVersion(result: UpdateCheckResult): result is ...`) into `src/update-check.ts` alongside the `UpdateCheckResult` type. Both `update.ts` and `list-detail.ts` import and call the shared predicate. The predicate checks the status discriminant and `latestOverall !== null`. The `entry.constraint` check in `update.ts` remains at the call site since it guards a different concern (manifest data vs check-result data).

**Outcome**: One canonical predicate for the out-of-constraint status check. The two call sites cannot diverge on which statuses qualify or whether `latestOverall` null-checking is performed.

**Do**:
1. In `src/update-check.ts`, add and export a predicate function:
   ```typescript
   export function hasOutOfConstraintVersion(
     result: UpdateCheckResult,
   ): boolean {
     return (
       (result.status === "constrained-update-available" ||
         result.status === "constrained-up-to-date") &&
       result.latestOverall !== null
     );
   }
   ```
2. In `src/commands/update.ts`, import `hasOutOfConstraintVersion` from `../update-check.js`. Replace the compound condition in `extractOutOfConstraint` (lines 103-106) with `hasOutOfConstraintVersion(checkResult) && entry.constraint !== undefined`. Keep the `entry.constraint` check at this call site.
3. In `src/commands/list-detail.ts`, import `hasOutOfConstraintVersion` from `../update-check.js`. Replace the inline compound condition (lines 142-145) with `hasOutOfConstraintVersion(updateStatus)`.
4. Run `pnpm test` -- all tests must pass with no changes to test behavior.

**Acceptance Criteria**:
- `hasOutOfConstraintVersion` is exported from `src/update-check.ts`
- Neither `update.ts` nor `list-detail.ts` contains inline status-matching logic for the out-of-constraint check
- Both call sites use the shared predicate
- All existing tests pass unchanged

**Tests**:
- Run full test suite (`pnpm test`) -- all tests pass
- Verify no inline `"constrained-update-available" || "constrained-up-to-date"` condition remains in `update.ts` or `list-detail.ts` outside the shared predicate (grep check)
