---
topic: core-system
cycle: 5
total_proposed: 4
---
# Analysis Tasks: Core System (Cycle 5)

## Task 1: Derive agent/asset-type classification from driver registry instead of path substrings
status: pending
severity: medium
sources: architecture

**Problem**: Two locations reconstruct the agent-to-directory and asset-type-to-directory mapping by pattern-matching on file path strings rather than consulting the driver registry. `list-detail.ts:deriveAgent` hardcodes `.claude/` -> `claude` and `.agents/` -> `codex`. `classifyAssetType` uses `filePath.includes("/skills/")` substring matching. `remove.ts:classifyFile` uses the same substring approach. These are the inverse of the driver's `getTargetDir` configuration but implemented independently via string heuristics. If a driver's target directory changes or a new agent is added, these functions silently produce wrong results. The `includes()` approach is also fragile -- a path like `.claude/skills/my-agents-toolkit/` would match both `/skills/` and `/agents/`.

**Solution**: Add a utility in the driver layer (e.g., `identifyFileOwnership(filePath: string): { agentId: AgentId; assetType: AssetType } | null`) that iterates registered drivers and their `getTargetDir` results to find which agent/asset-type pair owns a given path prefix. Use `startsWith` against actual driver target dirs rather than `includes` against hardcoded substrings. Both `list-detail.ts` and `remove.ts` import this single function.

**Outcome**: Agent and asset-type classification is derived from the single source of truth (driver registry). Adding a new agent or changing a target directory automatically propagates to all classification call sites. The substring false-positive risk is eliminated.

**Do**:
1. In the driver layer (e.g., `src/drivers/registry.ts` or a new `src/drivers/identify.ts`), add a function `identifyFileOwnership(filePath: string): { agentId: AgentId; assetType: AssetType } | null`.
2. Implement by iterating all registered drivers, calling `getTargetDir` for each asset type, and checking if `filePath.startsWith(targetDir)`. Return the first match or null.
3. In `src/commands/list-detail.ts`, replace `deriveAgent` and `classifyAssetType` with calls to `identifyFileOwnership`.
4. In `src/commands/remove.ts`, replace `classifyFile` logic with a call to `identifyFileOwnership`.
5. Remove the now-unused hardcoded path-matching functions.
6. Verify all existing tests pass.

**Acceptance Criteria**:
- No file outside the driver layer contains hardcoded agent-to-directory or asset-type-to-directory mappings for classification purposes
- `identifyFileOwnership` is the single function used for reverse-mapping file paths to agent/asset-type
- Uses `startsWith` against actual driver target dirs, not `includes` against substrings
- All existing list-detail and remove tests pass

**Tests**:
- identifyFileOwnership correctly identifies a `.claude/skills/foo` path as { agentId: "claude", assetType: "skills" }
- identifyFileOwnership correctly identifies a `.agents/foo.md` path as { agentId: "codex", assetType: "agents" }
- identifyFileOwnership returns null for an unrecognized path
- Existing list-detail tests pass with the new classification approach
- Existing remove tests pass with the new classification approach

---

## Task 2: Consolidate mapCloneFailure handler blocks between list-update-action.ts and list-change-version-action.ts
status: pending
severity: medium
sources: duplication

**Problem**: Both `list-update-action.ts` and `list-change-version-action.ts` call `mapCloneFailure` with 6 handler callbacks that return a result-object with a boolean flag and message string. The handlers are structurally identical -- the only differences are the field name (`success` vs `changed`) and 2 of the 6 message strings (`onNoConfig` and `onInvalidType` use "New version of" in the change-version variant). The remaining 4 handlers (`onNoAgents`, `onCopyFailed`, `onCloneFailed`, `onUnknown`) produce character-for-character identical messages. This is approximately 25 lines duplicated across the two files.

**Solution**: Extract a shared helper that takes a `CloneReinstallFailed` result and a key, and returns a standard `{ message: string }` object. Each call site wraps it in its own return type (`{ success: false, ...msg }` vs `{ changed: false, ...msg }`). Something like `buildFailureMessage(result, key, { isChangeVersion?: boolean })` in `clone-reinstall.ts`. Each call site reduces to 2-3 lines.

**Outcome**: The failure message construction logic exists in one place. The 4 identical handlers are defined once. The 2 differing handlers are parameterized. Each call site is a thin wrapper mapping the shared message to its own result type.

**Do**:
1. In `src/clone-reinstall.ts`, add a function `buildFailureMessage(result: CloneReinstallFailed, key: string, opts?: { isChangeVersion?: boolean }): string` that dispatches on `result.failureReason` and returns the appropriate message string.
2. For the 4 identical handlers (onNoAgents, onCopyFailed, onCloneFailed, onUnknown), use the shared message directly.
3. For the 2 differing handlers (onNoConfig, onInvalidType), branch on `opts.isChangeVersion` to select the appropriate prefix ("New version of" vs standard).
4. In `src/commands/list-update-action.ts`, replace the `mapCloneFailure` call with `buildFailureMessage` and wrap in `{ success: false, message }`.
5. In `src/commands/list-change-version-action.ts`, replace the `mapCloneFailure` call with `buildFailureMessage` and wrap in `{ changed: false, message }`.
6. Verify all existing tests pass.

**Acceptance Criteria**:
- The 6 failure-message handler definitions no longer appear independently in both files
- A single shared function produces failure messages for both consumers
- list-update-action.ts and list-change-version-action.ts each have at most 2-3 lines for failure handling
- All existing tests pass with identical user-visible output

**Tests**:
- Existing list-update-action tests pass for all failure reasons
- Existing list-change-version-action tests pass for all failure reasons
- buildFailureMessage produces correct messages for each failure reason with and without isChangeVersion flag

---

## Task 3: Deduplicate formatRef by reusing formatRefLabel from summary.ts
status: pending
severity: low
sources: duplication

**Problem**: `list-detail.ts` defines `formatRef(entry: ManifestEntry)` and `summary.ts` exports `formatRefLabel(ref, commit)`. Both implement the same logic: if ref is non-null return it, if there is a commit return "HEAD", otherwise return "local". The only difference is the function signature -- one takes a ManifestEntry, the other takes ref and commit as separate parameters.

**Solution**: Remove `formatRef` from `list-detail.ts` and import `formatRefLabel` from `summary.ts` instead. Call it as `formatRefLabel(entry.ref, entry.commit)`.

**Outcome**: One canonical implementation of the ref-label formatting logic. No behavioral change.

**Do**:
1. In `src/commands/list-detail.ts`, remove the local `formatRef` function (lines 13-17).
2. Add `import { formatRefLabel } from "../summary"` to `list-detail.ts`.
3. Replace all calls to `formatRef(entry)` with `formatRefLabel(entry.ref, entry.commit)`.
4. Verify all existing tests pass.

**Acceptance Criteria**:
- `formatRef` no longer exists in list-detail.ts
- list-detail.ts imports and uses `formatRefLabel` from summary.ts
- No behavioral change in list detail output

**Tests**:
- Existing list-detail tests pass with identical output
- Existing summary tests pass unchanged

---

## Task 4: Strengthen CollectionPluginResult.detectedType to use concrete DetectedType union
status: pending
severity: low
sources: architecture

**Problem**: `add.ts` defines `PluginInstallResult` with `detectedType?: DetectedType` (the concrete discriminated union from `type-detection.ts`). `summary.ts` defines a near-identical `CollectionPluginResult` interface but declares `detectedType?: { type: string }`. The only consumer of `detectedType` in summary.ts is line 113: `r.detectedType?.type === "plugin"`. Using `{ type: string }` means a typo like `"pluginn"` would be a valid value at compile time and the comparison would silently return false.

**Solution**: Import `DetectedType` from `type-detection.ts` in `summary.ts` and use it for the `detectedType` field in `CollectionPluginResult`. This aligns the type with `PluginInstallResult` in `add.ts`.

**Outcome**: Compile-time validation catches invalid `detectedType` values. The two interfaces share the same concrete type for this field.

**Do**:
1. In `src/summary.ts`, add `import { DetectedType } from "./type-detection"` (or adjust the import path as needed).
2. In the `CollectionPluginResult` interface, change `detectedType?: { type: string }` to `detectedType?: DetectedType`.
3. Verify all existing tests pass.

**Acceptance Criteria**:
- `CollectionPluginResult.detectedType` uses the concrete `DetectedType` union type, not `{ type: string }`
- All existing tests pass
- No behavioral change

**Tests**:
- Existing summary tests pass unchanged
- Existing add command tests pass unchanged
