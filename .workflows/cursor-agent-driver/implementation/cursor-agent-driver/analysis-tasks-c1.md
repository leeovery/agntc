---
topic: cursor-agent-driver
cycle: 1
total_proposed: 1
---
# Analysis Tasks: Cursor Agent Driver (Cycle 1)

## Task 1: Deduplicate PluginInstallResult / CollectionPluginResult interfaces
status: pending
severity: medium
sources: duplication

**Problem**: `PluginInstallResult` in `src/commands/add.ts:347` and `CollectionPluginResult` in `src/summary.ts:101` are field-for-field identical interfaces (pluginName, status, copiedFiles, agents, assetCountsByAgent?, detectedType?, errorMessage?). If one evolves, the other must be updated manually with no compiler help.

**Solution**: Extract a single shared interface and export it from one location. Delete the duplicate. Both `add.ts` and `summary.ts` import the shared definition.

**Outcome**: One interface definition used by both modules. Adding or changing a field is a single edit with compiler-enforced propagation.

**Do**:
1. In `src/summary.ts`, export the `CollectionPluginResult` interface (rename to `PluginInstallResult` for consistency with the producing module, or keep whichever name is clearer).
2. In `src/commands/add.ts`, remove the local `PluginInstallResult` interface and import it from `src/summary.ts` (or from a shared types file if a better home exists).
3. Alternatively, create a shared type in an existing types file (e.g., `src/drivers/types.ts` or a new `src/types.ts`) and have both modules import from there.
4. Verify no field mismatches — currently identical, but confirm at implementation time.
5. Run `npm test` to confirm nothing breaks.

**Acceptance Criteria**:
- Only one definition of the plugin-install-result interface exists in the codebase
- Both `add.ts` and `summary.ts` import from the same source
- All existing tests pass without modification

**Tests**:
- `npm test` passes (existing tests cover both add and summary paths)
- `grep -r "interface.*PluginInstallResult\|interface.*CollectionPluginResult" src/` returns exactly one match
