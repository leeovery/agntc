TASK: Extract cloneAndReinstall call-object builder in update.ts

ACCEPTANCE CRITERIA:
- Both call sites use the shared builder
- No change in behavior for single-plugin or batch update paths

STATUS: Complete

SPEC CONTEXT: The update command performs nuke-and-reinstall for both constrained and unconstrained plugins. Both single-plugin (`runSinglePluginUpdate`) and batch (`processUpdateForAll`) paths construct argument objects for `cloneAndReinstall` with the same conditional spread patterns for `sourceDir` (local), `newRef`/`newCommit` (constrained overrides), and `manifest` (auto-removal on copy-failed). This task is a pure refactor to eliminate the duplicated object construction.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/update.ts:199-217 (buildReinstallInput definition), src/commands/update.ts:233 (call in runSinglePluginUpdate), src/commands/update.ts:331 (call in processUpdateForAll)
- Notes:
  - The helper `buildReinstallInput` accepts `key`, `entry`, `projectDir`, optional `manifest`, and optional `overrides` (ConstrainedUpdateOverrides interface at line 194-197).
  - `isLocal` is derived from `entry.commit === null` inside the helper (line 206), rather than being passed as a parameter. This is a minor positive deviation from the plan (which suggested an `isLocal` parameter) -- deriving it eliminates the possibility of caller/builder inconsistency.
  - `runSinglePluginUpdate` (line 233) passes `manifest` for auto-removal on copy-failed; `processUpdateForAll` (line 331) passes `undefined` for manifest because batch mode handles manifest writes centrally at lines 521-543. This preserves the original behavioral difference between the two paths.
  - No inline `cloneAndReinstall({...})` object constructions remain in the file -- both calls use the helper exclusively (confirmed via grep).
  - Return type is explicitly `CloneAndReinstallOptions` (line 205), providing type safety.

TESTS:
- Status: Adequate
- Coverage: This is a pure refactor with no behavioral change. The existing update command test suite at tests/commands/update.test.ts covers both single-plugin and batch update paths extensively. The helper is private (not exported), so testing through the public API is the correct approach.
- Notes: The acceptance criteria explicitly states "Existing update command tests continue to pass (this is a pure refactor)." No new test is needed or expected.

CODE QUALITY:
- Project conventions: Followed. Uses `interface` for the ConstrainedUpdateOverrides type (per TypeScript skill guidance to prefer interface for object shapes). Function is not exported (private helper), consistent with the codebase pattern for internal helpers.
- SOLID principles: Good. Single responsibility -- the helper does one thing (build the options object). The conditional spread logic is isolated in one place, satisfying DRY.
- Complexity: Low. The helper is a pure function with straightforward conditional spreads. No branching complexity.
- Modern idioms: Yes. Uses optional parameters, conditional spread syntax, and explicit return type annotation.
- Readability: Good. The function name `buildReinstallInput` clearly communicates intent. The `ConstrainedUpdateOverrides` interface names the override concept explicitly.
- Issues: None.

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
