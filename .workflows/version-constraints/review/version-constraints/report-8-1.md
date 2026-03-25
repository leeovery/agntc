TASK: Unify ConstrainedUpdateOverrides and UpdateActionOverrides into a single shared interface

ACCEPTANCE CRITERIA:
- Only one interface definition exists for the `{ newRef, newCommit }` override shape
- Both `update.ts` and `list-update-action.ts` import the shared type
- All existing tests pass without modification

STATUS: Complete

SPEC CONTEXT: The version constraints feature introduces constrained updates where a resolved tag/commit pair needs to be passed as overrides during nuke-and-reinstall. Both the update command and the list-update-action module need to pass these overrides, creating a shared type requirement. The spec describes the constrained update flow (resolve best tag, pass to reinstall) which is the use case for this override shape.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/version-resolve.ts:26-29 (single `VersionOverrides` interface definition, exported)
  - src/commands/update.ts:30 (imports `type VersionOverrides` from `../version-resolve.js`)
  - src/commands/update.ts:200,220,309 (uses `VersionOverrides` in function signatures)
  - src/commands/list-update-action.ts:6 (imports `type VersionOverrides` from `../version-resolve.js`)
  - src/commands/list-update-action.ts:19,29 (uses `VersionOverrides` in function signatures)
- Notes: The old `ConstrainedUpdateOverrides` (previously in update.ts) and `UpdateActionOverrides` (previously in list-update-action.ts) have been fully removed. No remnants in source files. The inline object construction in list.ts:162 (`{ newRef: freshStatus.tag, newCommit: freshStatus.commit }`) is correctly inferred as compatible with `VersionOverrides` via the `executeUpdateAction` parameter type.

TESTS:
- Status: Adequate
- Coverage: This is a pure type refactor with zero runtime change. No new tests are needed. Existing tests for update command (tests/commands/update.test.ts) and list-update-action (tests/commands/list-update-action.test.ts) exercise the functions that use `VersionOverrides`. No test references any of the old or new interface names directly, confirming no test modifications were required.
- Notes: TypeScript compilation serves as the primary verification that the type unification is correct. The fact that tests pass without modification confirms behavioral equivalence.

CODE QUALITY:
- Project conventions: Followed. Uses `interface` for the object shape (consistent with TypeScript skill guidance). Uses `type` import syntax (`import type { VersionOverrides }`). Placed in `version-resolve.ts` which already hosts shared version-constraint logic.
- SOLID principles: Good. Single definition eliminates the DRY violation. The interface is small and focused (Interface Segregation). Placement in `version-resolve.ts` keeps version-resolution-related types co-located.
- Complexity: Low. Simple interface definition with two string fields.
- Modern idioms: Yes. Uses `import type` for type-only imports.
- Readability: Good. `VersionOverrides` is a clear, descriptive name that communicates the concept better than either predecessor (`ConstrainedUpdateOverrides` was too specific to one use case; `UpdateActionOverrides` was tied to one consumer).
- Issues: None.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
