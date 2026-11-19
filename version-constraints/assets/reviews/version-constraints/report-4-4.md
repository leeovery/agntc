TASK: Change-version action removes constraint

ACCEPTANCE CRITERIA:
- Change-version on constrained entry removes constraint from manifest
- Change-version on non-constrained entry works as before (no constraint to remove)
- Resulting manifest entry has ref set to selected tag, no constraint field
- Works with constrained-update-available status type
- Works with constrained-up-to-date + outOfConstraint status type

STATUS: Complete

SPEC CONTEXT: The spec (List Command Integration > Change version action) states: "The existing change-version action operates outside the constraint system -- it allows the user to pick any available tag. Selecting a specific tag via the list action is equivalent to re-adding with an exact pin, removing the constraint." The nuke-reinstall pipeline at `src/nuke-reinstall-pipeline.ts:142-144` preserves the constraint from the existing entry, so the change-version action must actively strip it.

IMPLEMENTATION:
- Status: Implemented
- Location: `src/commands/list-change-version-action.ts`
- Notes:
  - `ChangeVersionStatus` type (line 15-20) correctly unions `newer-tags`, `constrained-update-available`, and `constrained-up-to-date` using `Extract`
  - `isChangeVersionStatus` guard (line 22-30) correctly checks all three status strings
  - `resolveTagsForSelect` (line 32-44) routes tag sourcing: `newer-tags` uses inline tags, constrained statuses fetch all remote tags via `fetchRemoteTags` then reverse for newest-first presentation
  - `stripConstraint` (line 46-49) uses clean destructuring `{ constraint: _, ...rest }` to produce a new object without the constraint key
  - `stripConstraint` is unconditionally applied on success (line 99), which is correct: for non-constrained entries the destructuring is a no-op since `constraint` is already absent
  - `addEntry` and `writeManifest` are called with the stripped entry (lines 100-101)
  - The returned `newEntry` (line 105) is also the stripped entry, so callers get consistent data
  - All existing behavior paths (cancel, same-version, clone failure, copy failure) are preserved unchanged

TESTS:
- Status: Adequate
- Coverage:
  - Constrained entry with `constrained-update-available` status: constraint stripped, ref updated (line 519)
  - Constrained entry with `constrained-up-to-date` status: constraint stripped, ref updated (line 562)
  - Tag presentation order for constrained statuses: newest-first via fetchRemoteTags (line 597)
  - Non-constrained entry: no constraint field after change-version (line 645)
  - Tag source routing: `fetchRemoteTags` NOT called for `newer-tags` status (line 675)
  - Pre-existing tests cover: cancel, clone failure, all-agents-dropped, partial agent drop warning, temp dir cleanup, copy-failed recovery, and manifest write with new ref
- Notes: Tests are well-structured with appropriate mocking. Each test verifies one clear behavior. The constrained test section (`describe("constrained entry change-version")`) groups all constraint-related tests logically. No over-testing observed -- each test covers a distinct path or assertion.

CODE QUALITY:
- Project conventions: Followed. Uses the established patterns: vi.mock at top, factory helpers, descriptive describe/it blocks, consistent mock naming.
- SOLID principles: Good. `stripConstraint` is a pure function with single responsibility. `resolveTagsForSelect` cleanly separates tag sourcing logic from the main action flow. `isChangeVersionStatus` is a proper type guard.
- Complexity: Low. The `executeChangeVersionAction` function has a clear linear flow: guard -> resolve tags -> prompt -> guard same-version -> reinstall -> guard failure -> strip -> write. No nested conditionals or complex branching.
- Modern idioms: Yes. Proper use of TypeScript `Extract` utility type for `ChangeVersionStatus`, discriminated union narrowing via the type guard, rest/spread destructuring for constraint stripping.
- Readability: Good. The `stripConstraint` function name clearly communicates intent. The `ChangeVersionStatus` type alias and `isChangeVersionStatus` guard make the status filtering self-documenting.
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
