# Implementation Review: Version Constraints

**Plan**: version-constraints
**QA Verdict**: Request Changes

## Summary

Excellent implementation across 30 tasks in 6 phases. The version constraint system is comprehensive — parsing, resolution, add/update/list integration, and two analysis-driven refactoring phases are all solidly implemented with thorough test coverage. Out of 30 tasks verified, 29 passed cleanly with zero blocking issues. One task (vc-4-1: constrained label formatting in list view) has a defensive edge case gap that needs attention before approval.

## QA Verification

### Specification Compliance

Implementation aligns closely with the specification across all areas:
- Constraint syntax (`^`, `~`) with partial version support and pre-1.0 handling
- Parser disambiguation and validation via `semver.validRange()`
- Manifest storage with optional `constraint` field (absence = no constraint)
- Add command: bare add auto-applies `^X.Y.Z`, explicit constraints resolve best match, exact tags/branches preserve existing behavior
- Collection propagation: constraint applied once, propagated to all selected plugins
- Update routing: constrained entries resolve within bounds, out-of-constraint detection works
- List integration: label formatting, status hints, detail view actions, change-version strips constraint
- Tag normalization pipeline using `semver.clean()` (not `coerce()`), v-prefix preference on duplicates

No specification deviations detected.

### Plan Completion

- [x] Phase 1: Constraint Parsing and Version Resolution (7/7 tasks)
- [x] Phase 2: Add Command with Constraints (5/5 tasks)
- [x] Phase 3: Constrained Update Flow (5/5 tasks)
- [x] Phase 4: List Command Integration (4/4 tasks — 1 with issues)
- [x] Phase 5: Analysis Cycle 1 (5/5 tasks)
- [x] Phase 6: Analysis Cycle 2 (4/4 tasks)
- [x] All 30 tasks completed
- [x] No scope creep detected

### Code Quality

No issues found. Implementation follows project conventions consistently:
- Clean separation of concerns (parser, resolver, manifest, commands)
- Shared helpers extracted during analysis phases (parseTagRefs, isAtOrAboveVersion, buildReinstallInput, formatDroppedAgentsSuffix)
- Test factories and git mock helpers consolidated into shared modules
- Discriminated union types for UpdateCheckResult with constrained variants

### Test Quality

Tests adequately verify requirements across all tasks with one exception:
- **vc-4-1**: Missing test for constraint-present + ref-null edge case in formatLabel

### Required Changes

1. **formatLabel constraint-with-null-ref edge case** (`src/commands/list.ts:20-22`): When `entry.constraint` is truthy but `entry.ref` is null, the function returns just `key` instead of `key  ^1.0`. The condition `entry.constraint && entry.ref !== null` conflates two independent checks. Restructure to check `entry.constraint` first, then conditionally append arrow+ref. Add corresponding test.

## Recommendations

- Consider exporting `formatLabel` as a named function and creating focused unit tests (avoids full `runListLoop` mock setup for pure-function tests)
- A tilde constraint test for formatLabel (`~1.2 -> v1.2.5`) would document the behavior explicitly, though the implementation handles tilde identically to caret
