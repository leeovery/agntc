---
phase: 3
phase_name: Constrained Update Flow
total: 5
---

## vc-3-1 | pending

### Task vc-3-1: Constrained update check in update-check

**Problem**: The `checkForUpdate` function in `src/update-check.ts` has no awareness of version constraints. When a manifest entry has a `constraint` field (e.g. `^1.0`), the update check should resolve the best matching tag within constraint bounds via semver, compare it against the current `ref`, and also detect whether newer versions exist outside the constraint. Currently, constrained entries fall into the `isTagRef()` heuristic branch which uses simple string-based tag comparison -- this is incorrect for semver constraint resolution.

**Solution**: Add a new `checkConstrained` code path in `src/update-check.ts` that activates when `entry.constraint` is present. This function fetches all tags via `ls-remote`, runs them through the tag normalization pipeline (`normalizeTags` from `src/version-resolve.ts`), resolves the best within-constraint match via `resolveVersion`, and determines the absolute latest stable tag via `resolveLatestVersion`. The `UpdateCheckResult` union type gains new constrained-specific statuses that include the resolved tag name and commit, plus optional out-of-constraint info.

**Outcome**: `checkForUpdate` correctly routes constrained manifest entries through semver-based resolution. It returns the best matching tag within constraint bounds, detects out-of-constraint versions, and handles edge cases (no match, ls-remote failure, pre-1.0 constraints). Non-constrained entries are completely unaffected.

**Do**:
- In `src/update-check.ts`, import `normalizeTags`, `resolveVersion`, and `resolveLatestVersion` from `./version-resolve.js` (Phase 1 outputs)
- Import `semver` (or just `gt` from semver) for comparing cleaned versions in out-of-constraint detection
- Extend the `UpdateCheckResult` union type with three new members:
  ```typescript
  | { status: "constrained-update-available"; tag: string; commit: string; outOfConstraint?: { latest: string } }
  | { status: "constrained-up-to-date"; outOfConstraint?: { latest: string } }
  | { status: "constrained-no-match"; constraint: string }
  ```
- In `checkForUpdate()`, add a guard after the local check (line ~50, after the `entry.ref === null && entry.commit === null` check) that routes to the new `checkConstrained` function when `entry.constraint` is defined:
  ```typescript
  if (entry.constraint !== undefined) {
    return checkConstrained(url, entry.ref, entry.commit!, entry.constraint);
  }
  ```
  This must come before the `isTagRef` / branch checks so constrained entries never fall through to the old tag/branch logic.
- Implement `async function checkConstrained(url: string, currentRef: string | null, currentCommit: string, constraint: string): Promise<UpdateCheckResult>`:
  1. Fetch tags via `execGit(["ls-remote", "--tags", url], { timeout: 15_000 })`
  2. Parse tags using the existing `parseAllTags()` helper
  3. Normalize tags via `normalizeTags(allTags)` from version-resolve
  4. Call `resolveVersion(normalizedTags, constraint)` to get the best within-constraint match
  5. If no match (returns null): return `{ status: "constrained-no-match", constraint }`
  6. Call `resolveLatestVersion(normalizedTags)` to find the absolute latest stable tag
  7. Determine out-of-constraint info: if `latestResult` exists and its cleaned version is higher than the within-constraint match's cleaned version (use `semver.gt(latest.cleaned, withinConstraint.cleaned)`), include `outOfConstraint: { latest: latestResult.original }` in the result
  8. Compare the resolved within-constraint tag name (`resolvedResult.original`) against `currentRef`:
     - If same tag name: return `{ status: "constrained-up-to-date", outOfConstraint? }`
     - If different and the resolved version is higher than the current version (use `semver.gt(resolvedResult.cleaned, semver.clean(currentRef) ?? "0.0.0")`): fetch the commit SHA for the resolved tag via `execGit(["ls-remote", url, "refs/tags/" + resolvedResult.original])`, parse the SHA, and return `{ status: "constrained-update-available", tag: resolvedResult.original, commit: sha, outOfConstraint? }`
     - If different but the resolved version is not higher (defensive -- should not occur since maxSatisfying returns the highest match): return `{ status: "constrained-up-to-date", outOfConstraint? }` -- never downgrade
  9. Wrap the entire function in try/catch and return `{ status: "check-failed", reason: (err as Error).message }` on error
- Export the updated `UpdateCheckResult` type so consumers (`update.ts`, `list.ts`) can use the new statuses

**Acceptance Criteria**:
- [ ] `checkForUpdate` routes entries with `constraint` field to the new `checkConstrained` code path
- [ ] Constrained entry with newer tag in bounds returns `"constrained-update-available"` with the tag name and commit
- [ ] Constrained entry already at best tag returns `"constrained-up-to-date"`
- [ ] Constrained entry where resolved tag is older than current ref returns `"constrained-up-to-date"` (never downgrade)
- [ ] Constrained entry where no tags satisfy constraint returns `"constrained-no-match"` with the constraint string
- [ ] Out-of-constraint detection: when absolute latest is higher than within-constraint best, `outOfConstraint.latest` is populated
- [ ] Out-of-constraint detection: when within-constraint best equals absolute latest, `outOfConstraint` is absent
- [ ] `ls-remote` failure returns `"check-failed"` with reason
- [ ] Non-constrained entries (no `constraint` field) are completely unaffected -- all existing tests pass unchanged

**Tests**:
- `"constrained entry returns constrained-update-available when newer tag exists within bounds"` -- entry has constraint "^1.0" and ref "v1.0.0"; ls-remote returns v1.0.0, v1.1.0, v2.0.0; expect status "constrained-update-available" with tag "v1.1.0"
- `"constrained entry returns constrained-up-to-date when at best tag"` -- entry has constraint "^1.0" and ref "v1.1.0"; ls-remote returns v1.0.0, v1.1.0; expect status "constrained-up-to-date"
- `"constrained entry returns constrained-no-match when no tags satisfy constraint"` -- entry has constraint "^3.0"; ls-remote returns v1.0.0, v2.0.0; expect status "constrained-no-match" with constraint "^3.0"
- `"constrained entry includes outOfConstraint when absolute latest exceeds within-constraint best"` -- entry has constraint "^1.0"; ls-remote returns v1.0.0, v1.1.0, v2.0.0; expect outOfConstraint.latest is "v2.0.0"
- `"constrained entry omits outOfConstraint when within-constraint best is absolute latest"` -- entry has constraint "^1.0"; ls-remote returns v1.0.0, v1.1.0 (no v2); expect no outOfConstraint field
- `"constrained entry handles pre-1.0 caret semantics"` -- entry has constraint "^0.2.3" and ref "v0.2.3"; ls-remote returns v0.2.3, v0.2.9, v0.3.0; expect constrained-update-available with tag "v0.2.9" (^0.2.3 means >=0.2.3 <0.3.0)
- `"constrained entry returns check-failed on ls-remote failure"` -- mock ls-remote to throw; entry has constraint "^1.0"; expect status "check-failed" with reason
- `"constrained entry handles all tags being pre-release"` -- entry has constraint "^1.0"; ls-remote returns only v1.0.0-beta.1, v2.0.0-rc.1; expect constrained-no-match (maxSatisfying excludes pre-release by default)
- `"constrained entry handles current ref tag deleted from remote"` -- entry has constraint "^1.0" and ref "v1.0.0"; ls-remote returns v1.1.0, v1.2.0 (v1.0.0 absent); expect constrained-update-available with tag "v1.2.0" (resolution works from available tags, not relative to current ref)
- `"constrained entry never downgrades when resolved tag is older than current ref"` -- entry has constraint "^1.0" and ref "v1.5.0" (manually set higher than constraint would resolve); ls-remote returns v1.0.0, v1.3.0; maxSatisfying returns v1.3.0 which is lower than v1.5.0; expect status "constrained-up-to-date" (not constrained-update-available)
- `"constrained entry with up-to-date and outOfConstraint"` -- entry has constraint "^1.0" and ref "v1.1.0"; ls-remote returns v1.0.0, v1.1.0, v2.0.0; expect status "constrained-up-to-date" with outOfConstraint.latest "v2.0.0"

**Edge Cases**:
- No tags satisfy constraint: return `constrained-no-match` with the constraint string for error messaging
- Current ref tag deleted from remote: resolution uses `maxSatisfying` against available tags regardless of current ref -- if a satisfying tag exists, it compares the resolved tag name against `currentRef` to determine if update is needed. If the current ref is not in the list, the resolved tag is always "different" so an update is triggered.
- All tags are pre-release: `maxSatisfying` with `^1.0` or `*` excludes pre-release tags by default, so both within-constraint and latest resolution return null -- treated as no-match
- Older resolved tag (never downgrade): if the current ref is higher than the resolved within-constraint best (e.g., manually edited manifest or constraint narrowed after install), skip the update. The spec says this "should not occur" but "if it does, skip -- never downgrade." Defensive check using `semver.gt()`.
- Pre-1.0 constraint (`^0.2.3`): handled by `semver.maxSatisfying` automatically -- `^0.2.3` means `>=0.2.3, <0.3.0`
- `ls-remote` failure: caught in try/catch, returns `check-failed` with the error message

**Context**:
> The spec defines constrained update flow (Manifest Storage > Constrained Update Flow): fetch tags, resolve best match via `maxSatisfying`, compare against current ref, nuke-and-reinstall if newer. The out-of-constraint detection (Manifest Storage > Out-of-Constraint Detection) uses the same tag data: find absolute latest via `maxSatisfying(cleanedVersions, '*')` and compare against the within-constraint best. Phase 1 provides `normalizeTags()`, `resolveVersion()`, and `resolveLatestVersion()` in `src/version-resolve.ts`. The `parseAllTags()` helper already exists in `src/update-check.ts` for parsing ls-remote tag output.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Manifest Storage > Constrained Update Flow", "Manifest Storage > Out-of-Constraint Detection", "Manifest Storage > Update Routing"

## vc-3-2 | pending

### Task vc-3-2: Constraint-absent entries remain unchanged

**Problem**: The introduction of constraint-aware update checking (vc-3-1) must not alter the behavior of manifest entries that have no `constraint` field. Entries tracking branches, exact tags (without constraint), HEAD, and local paths must continue to use the existing `checkHead`, `checkBranch`, and `checkTag` code paths. This task verifies backward compatibility is preserved and adds regression tests.

**Solution**: Verify that the guard condition in `checkForUpdate` (`entry.constraint !== undefined`) correctly excludes all non-constrained entry types. Write dedicated regression tests that exercise each existing update-check path with entries that explicitly lack a `constraint` field, confirming they produce the same results as before the constrained code was added.

**Outcome**: All four non-constrained entry types (tag ref without constraint, branch ref, HEAD-tracking, local) produce identical update check results as before vc-3-1. The new `checkConstrained` code path is never entered for these entries.

**Do**:
- Verify in `src/update-check.ts` that the routing logic in `checkForUpdate` is ordered correctly:
  1. Local check (`entry.ref === null && entry.commit === null`) -- returns `{ status: "local" }`, exits before constraint check
  2. Constraint check (`entry.constraint !== undefined`) -- routes to `checkConstrained`, exits before tag/branch
  3. HEAD check (`entry.ref === null`) -- routes to `checkHead`
  4. Tag check (`isTagRef(entry.ref)`) -- routes to `checkTag`
  5. Branch check (fallthrough) -- routes to `checkBranch`
- Ensure that the existing `makeEntry()` helper in `tests/update-check.test.ts` does NOT include a `constraint` field (it should be `undefined` by default, which means the constraint guard is skipped)
- Write regression tests that explicitly verify no constrained logic is invoked for each entry type. These tests use `entry.constraint` being `undefined` and verify the original behavior holds.
- All existing tests in `tests/update-check.test.ts` must continue to pass without modification (they were written for the non-constrained case)

**Acceptance Criteria**:
- [ ] Tag ref entry without `constraint` field uses the old `checkTag` path (returns `newer-tags` or `up-to-date`, not `constrained-*`)
- [ ] Branch ref entry without `constraint` uses `checkBranch` (returns `update-available` or `up-to-date`)
- [ ] HEAD-tracking entry without `constraint` uses `checkHead` (returns `update-available` or `up-to-date`)
- [ ] Local entry without `constraint` returns `{ status: "local" }` immediately
- [ ] No import from `version-resolve` is invoked for non-constrained entries
- [ ] All existing `tests/update-check.test.ts` tests pass unchanged

**Tests**:
- `"tag ref without constraint returns newer-tags via old logic"` -- entry has ref "v1.0.0" and no constraint field; ls-remote returns v1.0.0, v2.0.0; expect status "newer-tags" with tags ["v2.0.0"] (not "constrained-update-available")
- `"tag ref without constraint at latest returns up-to-date via old logic"` -- entry has ref "v2.0" and no constraint; ls-remote returns v1.0, v2.0; expect status "up-to-date"
- `"branch ref without constraint returns update-available when tip changes"` -- entry has ref "main" and no constraint; ls-remote returns different SHA; expect status "update-available" with remoteCommit
- `"branch ref without constraint returns up-to-date when tip matches"` -- entry has ref "main" and no constraint; ls-remote returns same SHA; expect status "up-to-date"
- `"HEAD-tracking without constraint returns update-available when HEAD changes"` -- entry has ref null, commit SHA, no constraint; ls-remote returns different SHA; expect status "update-available"
- `"local entry without constraint returns local status"` -- entry has ref null, commit null, no constraint; expect status "local"
- `"tag ref without constraint does not invoke normalizeTags"` -- spy on version-resolve imports; entry has ref "v1.0" and no constraint; verify normalizeTags/resolveVersion never called

**Edge Cases**:
- Tag ref without constraint uses the old `newer-tags` logic: the old logic uses string indexOf comparison within the `ls-remote --tags` output. This is distinct from the constraint-aware semver resolution. Both coexist; routing depends solely on `constraint` presence.
- Branch ref unaffected: branch names are not semver, never have constraint. `isTagRef` returns false for branch names, so they route to `checkBranch`.
- HEAD-tracking unaffected: `ref === null && commit !== null` routes to `checkHead` before the constraint check is reached (except it actually comes after the local check but `entry.constraint` would be undefined, so it would also skip the constraint check -- either way the HEAD path is taken).
- Local entry unaffected: the `ref === null && commit === null` check happens first, before any constraint check.

**Context**:
> The spec states (Manifest Storage > Update Routing): entries without `constraint` preserve existing behavior -- tag ref (refuse auto-update, show newer tags), branch ref (track branch HEAD), no ref (track HEAD). The `constraint` field is the sole routing signal. Its absence means the old logic applies.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Manifest Storage > Update Routing"

## vc-3-3 | pending

### Task vc-3-3: Single-plugin constrained update execution

**Problem**: The single-plugin update path in `src/commands/update.ts` (`runSingleUpdate`) handles the result of `checkForUpdate` but has no cases for the new constrained statuses (`constrained-update-available`, `constrained-up-to-date`, `constrained-no-match`). When a user runs `agntc update owner/repo` on a constrained plugin, the update command must: (a) execute nuke-and-reinstall when a newer tag is available within bounds, (b) report up-to-date when already at the best tag, (c) report an error when no tags satisfy the constraint, and (d) preserve the `constraint` field through the reinstall cycle.

**Solution**: Extend `runSingleUpdate` in `src/commands/update.ts` to handle the three new constrained check statuses. For `constrained-update-available`, call `cloneAndReinstall` with the resolved tag as `newRef` and the resolved commit as `newCommit`, then update the manifest. For `constrained-up-to-date`, display the up-to-date message. For `constrained-no-match`, display an error and exit without modifying the manifest. The `constraint` field is preserved through the nuke-reinstall pipeline because Phase 2 task vc-2-1 updated `executeNukeAndReinstall` to forward `existingEntry.constraint`.

**Outcome**: `agntc update owner/repo` on a constrained plugin correctly executes the update within constraint bounds, preserves the constraint, and handles all error cases. The manifest `constraint` field stays unchanged while `ref` and `commit` are updated.

**Do**:
- In `src/commands/update.ts`, in `runSingleUpdate()`, add cases for the new constrained statuses after the existing status checks (around line 83-108):
  ```typescript
  if (result.status === "constrained-no-match") {
    p.log.error(`No tags satisfy constraint ${result.constraint} for ${key}`);
    throw new ExitSignal(1);
  }

  if (result.status === "constrained-up-to-date") {
    p.outro(`${key} is already up to date.`);
    // out-of-constraint info is collected but displayed only in batch mode (vc-3-5)
    return null;
  }

  if (result.status === "constrained-update-available") {
    // Proceed to nuke-and-reinstall with the resolved tag
    return runSinglePluginUpdate(key, entry, manifest, projectDir, {
      newRef: result.tag,
      newCommit: result.commit,
    });
  }
  ```
- Modify `runSinglePluginUpdate` to accept optional `newRef` and `newCommit` parameters and pass them to `cloneAndReinstall`:
  ```typescript
  async function runSinglePluginUpdate(
    key: string,
    entry: ManifestEntry,
    manifest: Manifest,
    projectDir: string,
    overrides?: { newRef?: string; newCommit?: string },
  ): Promise<ManifestEntry | null> {
  ```
  Then pass `newRef` and `newCommit` to `cloneAndReinstall`:
  ```typescript
  const result = await cloneAndReinstall({
    key,
    entry,
    projectDir,
    manifest,
    newRef: overrides?.newRef,
    newCommit: overrides?.newCommit,
    ...(isLocal ? { sourceDir: key } : {}),
  });
  ```
- Verify that `cloneAndReinstall` in `src/clone-reinstall.ts` passes `newRef` through to `buildParsedSourceFromKey` (which sets it on the parsed source for `cloneSource`). Looking at the existing code (line 127-130): `buildParsedSourceFromKey(key, options.newRef ?? entry.ref, entry.cloneUrl)` -- this already uses `options.newRef` when provided. Good.
- Verify that the nuke-reinstall pipeline (via vc-2-1) preserves `constraint` from the existing entry on the new manifest entry
- Update the summary rendering for single-plugin constrained updates: the `renderGitUpdateSummary` call should show the old ref and new ref (e.g. `v1.0.0 -> v1.1.0`) instead of commit SHAs. Consider adding a `refLabel` or adjusting the summary to show tag transitions when both old and new refs are tags.

**Acceptance Criteria**:
- [ ] `constrained-update-available` triggers nuke-and-reinstall at the resolved tag
- [ ] `cloneAndReinstall` is called with `newRef` set to the resolved tag name and `newCommit` set to the resolved commit SHA
- [ ] The resulting manifest entry has updated `ref` and `commit` but the same `constraint` as before
- [ ] `constrained-up-to-date` displays "up to date" message and returns null (no manifest change)
- [ ] `constrained-no-match` displays error with the constraint string and throws ExitSignal(1) without modifying manifest
- [ ] `cloneAndReinstall` failure leaves the manifest entry untouched (constraint preserved)
- [ ] `writeManifest` is called with the updated entry (new ref/commit, same constraint)

**Tests**:
- `"constrained update-available triggers cloneAndReinstall with resolved tag"` -- mock checkForUpdate returning constrained-update-available with tag "v1.1.0" and commit; mock cloneAndReinstall success; verify cloneAndReinstall called with newRef "v1.1.0" and newCommit
- `"constrained update preserves constraint field through nuke-reinstall"` -- entry has constraint "^1.0"; mock successful update; verify writeManifest called with entry containing constraint "^1.0"
- `"constrained up-to-date displays message and returns null"` -- mock checkForUpdate returning constrained-up-to-date; verify p.outro called with "up to date" message; verify writeManifest not called
- `"constrained no-match displays error and throws ExitSignal"` -- mock checkForUpdate returning constrained-no-match with constraint "^3.0"; verify p.log.error called with message containing "^3.0"; verify ExitSignal thrown with code 1
- `"constrained no-match does not modify manifest"` -- mock checkForUpdate returning constrained-no-match; verify writeManifest not called
- `"cloneAndReinstall failure on constrained update leaves entry untouched"` -- mock checkForUpdate returning constrained-update-available; mock cloneAndReinstall returning failure; verify manifest entry is unchanged
- `"constrained update summary shows tag transition"` -- mock successful constrained update from v1.0.0 to v1.1.0; verify summary output includes the tag names

**Edge Cases**:
- No-match error without modifying manifest: when `constrained-no-match` is returned, the function throws ExitSignal(1) immediately. No `writeManifest` call occurs, and the manifest file is untouched.
- `cloneAndReinstall` failure leaves entry untouched: if the clone or reinstall fails, the existing error handling in `runSinglePluginUpdate` throws ExitSignal(1) without writing a new entry. The manifest on disk still has the old ref/commit/constraint.
- Constraint preserved through nuke-reinstall: Phase 2 task vc-2-1 ensures `executeNukeAndReinstall` copies `constraint` from `existingEntry` to the new entry. This task verifies that end-to-end.

**Context**:
> The spec states (Manifest Storage > Constrained Update Flow): "Newer tag -- apply the standard nuke-and-reinstall: delete manifest files, re-clone at the new tag, re-copy for the same agents. Update ref and commit; constraint stays unchanged." The `cloneAndReinstall` function already accepts `newRef` and `newCommit` options. The constraint is preserved via `executeNukeAndReinstall` which copies `existingEntry.constraint` (Phase 2 vc-2-1). The spec also says: "If no tag satisfies the constraint, report an error and leave the plugin untouched."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Manifest Storage > Constrained Update Flow" (steps 2-4)

## vc-3-4 | pending

### Task vc-3-4: Batch update with mixed constrained and unconstrained plugins

**Problem**: The batch update path (`runAllUpdates` in `src/commands/update.ts`) processes all installed plugins in parallel for update checks and then sequentially for reinstalls. It categorizes results by status (`update-available`, `local`, `newer-tags`, `up-to-date`, `check-failed`) but has no cases for the new constrained statuses. When a manifest contains a mix of constrained and unconstrained plugins, the batch update must correctly route each plugin through its appropriate update path.

**Solution**: Extend `runAllUpdates` to handle the three new constrained check statuses in both the categorization step and the execution step. `constrained-update-available` entries join the update queue (alongside `update-available` and `local`). `constrained-up-to-date` entries join the up-to-date list. `constrained-no-match` entries get their own category or join the check-failed list with a descriptive message. Out-of-constraint info from both `constrained-update-available` and `constrained-up-to-date` results is collected for the collated info section (implemented in vc-3-5).

**Outcome**: `agntc update` (no key) correctly handles manifests with any combination of constrained and unconstrained plugins. Each plugin follows its appropriate update path. Backward compatibility is maintained for manifests with no constrained plugins.

**Do**:
- In `runAllUpdates()`, extend the categorization switch (around line 344-360) with the three new constrained statuses:
  ```typescript
  case "constrained-update-available":
    constrainedUpdateAvailable.push(checked);
    break;
  case "constrained-up-to-date":
    upToDate.push(checked); // or a dedicated constrainedUpToDate list if needed for out-of-constraint info
    break;
  case "constrained-no-match":
    constrainedNoMatch.push(checked);
    break;
  ```
- Create a new `constrainedUpdateAvailable` array alongside the existing `updateAvailable` array. Also create a `constrainedNoMatch` array.
- For `constrained-up-to-date` entries: these go into the existing `upToDate` array for display purposes, but their `outOfConstraint` data must be collected separately for the info section (vc-3-5). Add a structure to collect out-of-constraint info:
  ```typescript
  interface OutOfConstraintInfo {
    key: string;
    latest: string;
    constraint: string;
  }
  const outOfConstraintInfos: OutOfConstraintInfo[] = [];
  ```
  During categorization, when a `constrained-up-to-date` or `constrained-update-available` result has `outOfConstraint`, push to this array.
- For the sequential update execution (around line 367-374), include `constrainedUpdateAvailable` entries. For each constrained-update-available entry, call `processUpdateForAll` with `newRef` and `newCommit` from the check result. This requires modifying `processUpdateForAll` to accept optional `newRef` and `newCommit`:
  ```typescript
  async function processUpdateForAll(
    key: string,
    entry: ManifestEntry,
    projectDir: string,
    overrides?: { newRef?: string; newCommit?: string },
  ): Promise<PluginOutcome>
  ```
  And pass them through to `cloneAndReinstall`.
- For `constrainedNoMatch` entries, add them to outcomes with a `"check-failed"` status and a descriptive summary:
  ```typescript
  for (const checked of constrainedNoMatch) {
    const result = checked.checkResult;
    if (result.status === "constrained-no-match") {
      outcomes.push({
        status: "check-failed",
        key: checked.key,
        summary: `${checked.key}: No tags satisfy constraint ${result.constraint}`,
      });
    }
  }
  ```
- Update the `allUpToDate` check to also consider `constrainedUpdateAvailable`, `constrainedNoMatch`, etc.
- Add the `PluginOutcome` type a new optional `outOfConstraint` field, or store out-of-constraint info in a parallel data structure for vc-3-5 to consume.
- Ensure the `allUpToDate` condition accounts for constrained entries:
  ```typescript
  const allUpToDate =
    updateAvailable.length === 0 &&
    constrainedUpdateAvailable.length === 0 &&
    local.length === 0 &&
    checkFailed.length === 0 &&
    constrainedNoMatch.length === 0 &&
    newerTags.length === 0;
  ```

**Acceptance Criteria**:
- [ ] Batch update with all constrained plugins processes each through semver resolution
- [ ] Batch update with no constrained plugins (pure backward compat) behaves identically to current behavior
- [ ] Mix of constrained + branch + tag-pinned + local plugins all update correctly in a single run
- [ ] `constrained-update-available` entries trigger nuke-and-reinstall at the resolved tag
- [ ] `constrained-up-to-date` entries are categorized as up-to-date
- [ ] `constrained-no-match` entries are reported as errors in the summary
- [ ] Out-of-constraint info is collected from both update-available and up-to-date constrained results
- [ ] A single `writeManifest` call writes all successful updates at the end
- [ ] The `allUpToDate` shortcut works correctly with constrained entries

**Tests**:
- `"batch update with all constrained plugins processes each correctly"` -- manifest has 2 plugins both with constraints; one has update available, other is up-to-date; verify one gets cloneAndReinstall called, other does not; single writeManifest call
- `"batch update with no constrained plugins is pure backward compat"` -- manifest has branch-tracking and HEAD-tracking plugins only; verify no normalizeTags/resolveVersion calls; all existing batch update logic applies
- `"batch update with mix of constrained and branch and local"` -- manifest has: constrained plugin (update available), branch plugin (update available), local plugin (always refresh); verify all three processed correctly, single writeManifest
- `"batch update with constrained no-match reports error in summary"` -- manifest has constrained plugin where no tags satisfy; verify outcome includes check-failed summary with constraint message
- `"batch update collects outOfConstraint info from constrained results"` -- manifest has constrained plugin with outOfConstraint; verify info is collected (exact rendering tested in vc-3-5)
- `"batch update allUpToDate is true when only constrained-up-to-date"` -- manifest has only constrained plugins all up-to-date; verify "All plugins are up to date" message
- `"batch update with mixed constrained and tag-pinned (no constraint)"` -- manifest has one constrained plugin (^1.0, update available) and one tag-pinned plugin (v2.0, newer tags exist); verify constrained goes through cloneAndReinstall, tag-pinned shows "newer-tags" info; both coexist in output
- `"batch update processes constrained-update-available with correct newRef/newCommit"` -- verify cloneAndReinstall receives the tag and commit from the constrained check result, not the entry's existing ref/commit

**Edge Cases**:
- All constrained: every plugin has a constraint field. All route through `checkConstrained`, categorize into constrained statuses, and process accordingly.
- No constrained (backward compat): no plugin has a constraint field. The new constrained arrays are empty, and all existing logic runs unchanged. This is the critical backward compatibility test.
- Mix of constrained + branch + tag-pinned + local: each entry type routes through its own check path. The categorization switch handles all statuses. The execution loop processes `updateAvailable` (branch/HEAD), `constrainedUpdateAvailable` (constrained), and `local` entries. The summary shows all outcomes together.
- `constrained-no-match` should not prevent other plugins from updating. It is reported in the summary as a warning/error but does not abort the batch.

**Context**:
> The spec states (Manifest Storage > Update Routing): the presence/absence of `constraint` determines update behavior. The batch update must handle all four states in the routing table. The spec also says out-of-constraint detection "runs for every constrained plugin during update" using "the same tag data already fetched via ls-remote" -- this happens in `checkConstrained` (vc-3-1), and the batch update collects the results. The collated info section output is handled by vc-3-5.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Manifest Storage > Update Routing", "Manifest Storage > Constrained Update Flow", "Manifest Storage > Out-of-Constraint Detection"

## vc-3-5 | pending

### Task vc-3-5: Out-of-constraint info section in update output

**Problem**: The update command's output currently has no concept of "newer versions outside constraint bounds." The spec requires a collated informational section at the end of update output that lists constrained plugins with newer versions available outside their constraint, along with the latest available version and the current constraint. This section should be info-toned (not warning), omitted entirely when no out-of-constraint versions exist, and appear after all per-plugin update results.

**Solution**: Add a `renderOutOfConstraintSection` function in `src/summary.ts` that formats the collated info section. In `src/commands/update.ts`, collect out-of-constraint info from constrained check results during both single-plugin and batch update flows, and render the section at the end of output. For single-plugin mode, the info appears after the plugin result. For batch mode, it appears after all per-plugin outcome lines.

**Outcome**: When constrained plugins have newer versions outside their bounds, the update output includes a clear informational section at the end. When no out-of-constraint versions exist, no section appears. The format matches the spec exactly.

**Do**:
- In `src/summary.ts`, add a new function:
  ```typescript
  interface OutOfConstraintEntry {
    key: string;
    latest: string;
    constraint: string;
  }

  export function renderOutOfConstraintSection(entries: OutOfConstraintEntry[]): string | null {
    if (entries.length === 0) return null;
    const lines = entries.map(e => `  ${e.key}  ${e.latest} available (constraint: ${e.constraint})`);
    return `\u2139 Newer versions outside constraints:\n${lines.join("\n")}`;
  }
  ```
  The function returns `null` when there are no entries (section omitted), or the formatted string when entries exist. Uses the info icon (`\u2139` = `i` in a circle) per the spec example.
- In `src/commands/update.ts`, for the **single-plugin update path** (`runSingleUpdate`):
  - After handling `constrained-up-to-date` and `constrained-update-available`, collect any `outOfConstraint` data from the check result
  - After the update result is displayed (via `p.outro` or `renderGitUpdateSummary`), if out-of-constraint info exists, render it via `p.log.info(renderOutOfConstraintSection(...))`
  - For `constrained-up-to-date` with `outOfConstraint`: display "up to date" message first, then the info section
  - For `constrained-update-available` with `outOfConstraint`: display the update summary first, then the info section
- In `src/commands/update.ts`, for the **batch update path** (`runAllUpdates`):
  - Collect `OutOfConstraintEntry` items during the categorization step (vc-3-4 sets this up). For each constrained check result that has `outOfConstraint`, push `{ key, latest: result.outOfConstraint.latest, constraint: entry.constraint! }` to the collection array.
  - After all per-plugin outcome lines are rendered (the for loop at the end of `runAllUpdates`), render the collated section:
    ```typescript
    const outOfConstraintSection = renderOutOfConstraintSection(outOfConstraintInfos);
    if (outOfConstraintSection !== null) {
      p.log.info(outOfConstraintSection);
    }
    ```
  - This ensures the section always appears at the very end, after all individual plugin results
- The format must match the spec example:
  ```
  i Newer versions outside constraints:
    owner/plugin-a  v2.0.0 available (constraint: ^1.0)
    owner/plugin-b  v3.1.0 available (constraint: ^2.0)
  ```

**Acceptance Criteria**:
- [ ] `renderOutOfConstraintSection` returns `null` for empty entries (section omitted)
- [ ] `renderOutOfConstraintSection` returns formatted string with info icon, header, and indented entries
- [ ] Single-plugin update with out-of-constraint info shows the section after the update result
- [ ] Single-plugin update without out-of-constraint info omits the section entirely
- [ ] Batch update with out-of-constraint info shows the collated section at the end, after all per-plugin results
- [ ] Batch update without out-of-constraint info omits the section entirely
- [ ] Multiple out-of-constraint plugins are listed together in a single section
- [ ] Info tone (not warning) -- uses `p.log.info`, not `p.log.warn`
- [ ] The section shows the latest available version and the constraint for each plugin

**Tests**:
- `"renderOutOfConstraintSection returns null for empty entries"` -- call with []; expect null
- `"renderOutOfConstraintSection formats single plugin"` -- call with [{ key: "owner/plugin-a", latest: "v2.0.0", constraint: "^1.0" }]; expect string containing header and "owner/plugin-a  v2.0.0 available (constraint: ^1.0)"
- `"renderOutOfConstraintSection formats multiple plugins"` -- call with two entries; expect string containing both plugin lines under single header
- `"single-plugin update shows out-of-constraint info after result"` -- mock constrained-update-available with outOfConstraint; verify p.log.info called with section containing the latest version after update summary
- `"single-plugin up-to-date shows out-of-constraint info after message"` -- mock constrained-up-to-date with outOfConstraint; verify p.log.info called with section after "up to date" message
- `"single-plugin update omits section when no out-of-constraint"` -- mock constrained-update-available without outOfConstraint; verify p.log.info not called with section content
- `"batch update shows collated out-of-constraint section at end"` -- manifest has two constrained plugins both with outOfConstraint; verify p.log.info called once with section containing both plugins, and it appears after all per-plugin log calls
- `"batch update omits section when no out-of-constraint versions"` -- manifest has constrained plugins but within-constraint best equals absolute latest for all; verify no out-of-constraint section rendered
- `"within-constraint best equals absolute latest omits from section"` -- one constrained plugin with outOfConstraint and one without; verify section only contains the one with outOfConstraint
- `"section uses info tone not warning"` -- verify `p.log.info` is used for the section, not `p.log.warn`

**Edge Cases**:
- No out-of-constraint (section omitted): when all constrained plugins have within-constraint best equal to absolute latest, `renderOutOfConstraintSection` receives an empty array and returns null. The calling code checks for null and skips the `p.log.info` call entirely.
- Single plugin: the section format is the same regardless of single or batch mode. Same header, same indentation.
- Multiple plugins: all out-of-constraint entries collated under a single header. Each entry on its own indented line.
- Within-constraint best equals absolute latest: this plugin is NOT included in the out-of-constraint section. The `outOfConstraint` field is absent from its check result (vc-3-1 handles this), so it never enters the collection.

**Context**:
> The spec (Update Output UX > Format) provides the exact output format. The spec (Update Output UX > Rules) says: "Always collated at end -- never inline with individual plugin results", "Show latest only -- if they're going to bump their constraint, they want to know the ceiling", "Info tone, not warning -- the user chose the constraint deliberately", "Omit section entirely if no out-of-constraint versions exist." The section applies to both single-plugin and batch update modes per the spec: "Same format regardless of single-plugin or batch update."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Update Output UX > Format", "Update Output UX > Rules"
