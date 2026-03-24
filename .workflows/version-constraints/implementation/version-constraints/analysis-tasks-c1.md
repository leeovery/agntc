---
topic: version-constraints
cycle: 1
total_proposed: 5
---
# Analysis Tasks: Version Constraints (Cycle 1)

## Task 1: Fix list update action to forward constrained update resolution
status: pending
severity: high
sources: architecture

**Problem**: When the list detail view shows "Update" for a constrained plugin (status `constrained-update-available`), clicking update calls `executeUpdateAction` in `src/commands/list-update-action.ts`, which calls `cloneAndReinstall` without passing the resolved tag or commit from the update check result. The update check already resolved the best matching tag within constraint bounds (returned in the `UpdateCheckResult`), but `executeUpdateAction` does not accept or forward these overrides. This causes constrained updates from the list UI to either no-op or re-install the current version. Compare with `src/commands/update.ts:162-172` which correctly passes `{ newRef: result.tag, newCommit: result.commit }` for `constrained-update-available`.

**Solution**: Extend `executeUpdateAction` to accept an optional overrides parameter (`{ newRef: string; newCommit: string }`) and forward it to `cloneAndReinstall`. In `src/commands/list.ts` at the `action === "update"` branch, pass the resolved tag and commit from `freshStatus` when the status is `constrained-update-available`.

**Outcome**: Constrained plugins update correctly to the resolved tag when the user selects "update" from the list detail view, matching the behavior of the `update` command.

**Do**:
1. In `src/commands/list-update-action.ts`, add an optional `overrides?: { newRef: string; newCommit: string }` parameter to both `executeUpdateAction` and `runUpdate`.
2. In `runUpdate`, spread the overrides into the `cloneAndReinstall` call: `...(overrides ? { newRef: overrides.newRef, newCommit: overrides.newCommit } : {})`.
3. In `src/commands/list.ts` at the `action === "update"` branch (~line 156-168), check if `freshStatus.status === "constrained-update-available"` and pass `{ newRef: freshStatus.tag, newCommit: freshStatus.commit }` to `executeUpdateAction`.
4. Verify that `UpdateCheckResult` for `constrained-update-available` includes `tag` and `commit` fields accessible from the list context.

**Acceptance Criteria**:
- `executeUpdateAction` accepts and forwards override ref/commit to `cloneAndReinstall`
- List UI constrained update installs the resolved tag, not the current ref
- Non-constrained updates from list UI are unaffected (no overrides passed)

**Tests**:
- Unit test: `executeUpdateAction` with overrides passes `newRef`/`newCommit` to `cloneAndReinstall`
- Unit test: `executeUpdateAction` without overrides behaves as before (no regression)

## Task 2: Consolidate ls-remote tag parsing into a single shared function
status: pending
severity: high
sources: duplication, architecture

**Problem**: Three independent functions parse `git ls-remote --tags` output: `fetchRemoteTags()` in `src/git-utils.ts:36-42`, `parseAllTags()` in `src/update-check.ts:36-47`, and `parseTagCommitMap()` in `src/update-check.ts:162-176`. All three split on newlines, filter empty lines, filter `^{}` annotated refs, split on tab, and strip `refs/tags/` prefix. `parseTagCommitMap` additionally retains the SHA. If the parsing logic needs to change (edge case in tag refs), three functions must be updated in sync.

**Solution**: Extract a single shared parser in `src/git-utils.ts` that returns an array of `{ tag: string; sha: string }` objects from raw ls-remote stdout. `fetchRemoteTags` maps to tag names only. `parseAllTags` and `parseTagCommitMap` in `update-check.ts` are replaced by calls to the shared parser (or to `fetchRemoteTags` for tag-name-only usage).

**Outcome**: ls-remote tag output is parsed in exactly one place. ~25 lines of duplicated parsing logic eliminated.

**Do**:
1. In `src/git-utils.ts`, add an exported function `parseTagRefs(stdout: string): Array<{ tag: string; sha: string }>` that implements the shared parse logic (split lines, filter empty, filter `^{}`, split tab, strip `refs/tags/`).
2. Refactor `fetchRemoteTags` to call `parseTagRefs` and map to tag names.
3. In `src/update-check.ts`, replace `parseAllTags` with a call that uses `parseTagRefs` (or `fetchRemoteTags` if it already fetches tags) to get tag names.
4. Replace `parseTagCommitMap` with a call to `parseTagRefs` that builds the `Map<string, string>` from the returned array.
5. Remove the now-unused `parseAllTags` and `parseTagCommitMap` functions.

**Acceptance Criteria**:
- Only one function parses raw ls-remote tag output
- All existing callers produce identical results
- No new exports beyond `parseTagRefs` (or similar)

**Tests**:
- Unit test `parseTagRefs` with representative ls-remote stdout (normal tags, v-prefixed, annotated `^{}` refs, empty lines)
- Existing tests for `fetchRemoteTags`, `checkConstrained`, and `checkTag` continue to pass

## Task 3: Extract downgrade prevention helper with safe fallback
status: pending
severity: medium
sources: duplication, architecture

**Problem**: The downgrade-prevention check `gte(clean(entry.ref) ?? "0.0.0", clean(result.tag) ?? "0.0.0")` appears identically in `src/commands/update.ts` at lines 155-158 (single-plugin path) and 494-497 (batch path). The `"0.0.0"` fallback when `clean()` returns null is fragile: if `entry.ref` is a non-semver string, the fallback produces a misleading comparison. Updating one check without the other creates divergence risk.

**Solution**: Extract a named helper function `isAtOrAboveVersion(currentRef: string | null, candidateTag: string): boolean` that encapsulates the clean + comparison logic. Both call sites use this helper. The helper should return `false` (proceed with update) when either ref is not parseable as semver, rather than treating unparseable refs as `0.0.0`.

**Outcome**: Downgrade guard logic lives in one place. Non-semver refs no longer silently compare as `0.0.0`.

**Do**:
1. Create the helper `isAtOrAboveVersion(currentRef: string | null, candidateTag: string): boolean` in `src/commands/update.ts` (or in `src/version-resolve.ts` if it fits better).
2. Implementation: `clean()` both inputs; if either returns null, return `false`; otherwise return `gte(cleanedCurrent, cleanedCandidate)`.
3. Replace the check at line ~155-158 with `if (isAtOrAboveVersion(entry.ref, result.tag))`.
4. Replace the check at line ~494-497 with the same call.

**Acceptance Criteria**:
- Single source of truth for the downgrade prevention comparison
- Non-semver refs cause the guard to return false (allow update) rather than comparing as 0.0.0
- Both single-plugin and batch update paths use the same helper

**Tests**:
- Unit test: `isAtOrAboveVersion("v1.3.0", "v1.2.0")` returns true (at or above)
- Unit test: `isAtOrAboveVersion("v1.2.0", "v1.3.0")` returns false (below)
- Unit test: `isAtOrAboveVersion("main", "v1.0.0")` returns false (non-semver current ref)
- Unit test: `isAtOrAboveVersion(null, "v1.0.0")` returns false (null ref)

## Task 4: Extract cloneAndReinstall call-object builder in update.ts
status: pending
severity: medium
sources: duplication

**Problem**: `runSinglePluginUpdate` (~line 210-220) and `processUpdateForAll` (~line 315-324) in `src/commands/update.ts` construct nearly identical argument objects for `cloneAndReinstall`, including the same conditional spread patterns: `(isLocal ? { sourceDir: key } : {})` and `(overrides !== undefined ? { newRef: overrides.newRef, newCommit: overrides.newCommit } : {})`. The two functions share the same purpose (execute a single plugin update) but differ only in error handling.

**Solution**: Extract a helper function `buildReinstallInput(key, entry, projectDir, manifest, overrides?, isLocal?)` that returns the options object. Both functions call this helper, then diverge only in error handling.

**Outcome**: ~10 lines of duplicated spread logic removed. Future changes to the call-object shape are made in one place.

**Do**:
1. Define a private helper `buildReinstallInput` in `src/commands/update.ts` that accepts key, entry, projectDir, manifest, optional overrides, and isLocal flag.
2. The helper returns the options object with the conditional spreads for sourceDir and newRef/newCommit.
3. Replace the object construction in `runSinglePluginUpdate` with a call to the helper.
4. Replace the object construction in `processUpdateForAll` with a call to the helper.

**Acceptance Criteria**:
- Both call sites use the shared builder
- No change in behavior for single-plugin or batch update paths

**Tests**:
- Existing update command tests continue to pass (this is a pure refactor)

## Task 5: Extract droppedAgents suffix formatter in summary.ts
status: pending
severity: medium
sources: duplication

**Problem**: Four instances of the droppedSuffix pattern exist in `src/summary.ts` (lines 148-151, 165-168, 190-193, 197-200). Each constructs a suffix string from a `droppedAgents` array with minor wording variations (sentence-start with period vs dash-prefixed). Four ~3-line blocks doing the same join-and-format operation.

**Solution**: Extract a `formatDroppedAgentsSuffix(droppedAgents: string[], style: "sentence" | "inline")` helper within `summary.ts` that handles both wording variants. Replace all four instances with single-line calls.

**Outcome**: Dropped-agents formatting logic lives in one place. Adding a new format variant or changing wording requires one edit.

**Do**:
1. Add a private helper `formatDroppedAgentsSuffix(droppedAgents: string[], style: "sentence" | "inline"): string` in `src/summary.ts`.
2. `"sentence"` style produces `. {agents} support removed by plugin author.`
3. `"inline"` style produces ` -- {agents} support removed by plugin author`
4. Replace the four droppedSuffix blocks with calls to this helper.

**Acceptance Criteria**:
- All four droppedSuffix constructions use the shared helper
- Output strings are identical to current behavior for both styles

**Tests**:
- Existing summary rendering tests continue to pass
- Unit test: `formatDroppedAgentsSuffix(["codex"], "sentence")` produces expected string
- Unit test: `formatDroppedAgentsSuffix(["claude", "codex"], "inline")` produces expected string
