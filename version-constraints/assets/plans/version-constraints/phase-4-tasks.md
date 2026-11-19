---
phase: 4
phase_name: List Command Integration
total: 4
---

## vc-4-1 | pending

### Task vc-4-1: Constrained label formatting in list view

**Problem**: The `formatLabel` function in `src/commands/list.ts` currently shows `key@ref` (e.g. `owner/repo@v1.2.3`) when a ref is present, or just `key` when ref is null. When a plugin has a constraint (e.g. `^1.0`), the label should communicate both the constraint and the currently resolved ref so users can see at a glance what version range they are tracking and where they currently sit within it. Without this, constrained plugins look identical to exact-pinned plugins in the list view.

**Solution**: Modify `formatLabel` in `src/commands/list.ts` to check for `entry.constraint`. When present, format as `key  ^1.0 -> v1.2.3` (constraint arrow ref). When absent, preserve the existing format (`key@ref` or just `key`). The arrow notation (`->`) mirrors the spec's display example (`^1.0 -> v1.2.3`) and visually distinguishes constrained entries from exact pins.

**Outcome**: Constrained plugins show `owner/repo  ^1.0 -> v1.2.3` in the list view. Non-constrained plugins display identically to current behavior. The constraint and current ref are both visible at a glance.

**Do**:
- In `src/commands/list.ts`, modify the `formatLabel` function signature to accept the full `ManifestEntry` (it already does):
  ```typescript
  function formatLabel(key: string, entry: ManifestEntry): string {
  ```
- Add a constraint check at the top of `formatLabel`:
  ```typescript
  if (entry.constraint !== undefined) {
    const refPart = entry.ref !== null ? ` \u2192 ${entry.ref}` : "";
    return `${key}  ${entry.constraint}${refPart}`;
  }
  ```
  Uses `\u2192` (right arrow character) for the constraint-to-ref display. If `entry.ref` is null (defensive -- should not normally happen for constrained entries since they resolve to a tag), show just the constraint.
- Leave the existing non-constrained logic unchanged:
  ```typescript
  if (entry.ref !== null) {
    return `${key}@${entry.ref}`;
  }
  return key;
  ```
- Also update `renderDetailView` in `src/commands/list-detail.ts` to show constraint info. After the `Plugin: ${key}` info line, add a constraint line when present:
  ```typescript
  if (entry.constraint !== undefined) {
    p.log.info(`Constraint: ${entry.constraint}`);
  }
  ```
  This appears before the existing `Ref:` line, giving context for the ref value.
- Write tests in `tests/list-format.test.ts` (new file) for the `formatLabel` function. Export `formatLabel` from `list.ts` or test it indirectly. Since `formatLabel` is currently a private function, consider either: (a) exporting it for testability, or (b) testing through the `showListView` function's output. Option (a) is simpler -- add `export` to `formatLabel`.

**Acceptance Criteria**:
- [ ] Constrained entry with ref shows `key  ^1.0 -> v1.2.3` format in list view
- [ ] Constrained entry with null ref (defensive) shows `key  ^1.0` without arrow or ref
- [ ] Non-constrained entry with ref shows `key@v1.2.3` (existing behavior unchanged)
- [ ] Non-constrained entry without ref shows `key` (existing behavior unchanged)
- [ ] Detail view shows `Constraint: ^1.0` line when constraint is present
- [ ] Detail view omits constraint line when no constraint

**Tests**:
- `"formatLabel with constraint and ref shows constraint arrow ref"` -- entry has constraint "^1.0" and ref "v1.2.3"; expect `"owner/repo  ^1.0 \u2192 v1.2.3"`
- `"formatLabel with constraint and null ref shows constraint only"` -- entry has constraint "^1.0" and ref null; expect `"owner/repo  ^1.0"`
- `"formatLabel with tilde constraint shows tilde"` -- entry has constraint "~1.2" and ref "v1.2.5"; expect `"owner/repo  ~1.2 \u2192 v1.2.5"`
- `"formatLabel without constraint with ref shows key@ref"` -- entry has no constraint and ref "v1.2.3"; expect `"owner/repo@v1.2.3"` (unchanged)
- `"formatLabel without constraint without ref shows key only"` -- entry has no constraint and ref null; expect `"owner/repo"` (unchanged)
- `"formatLabel without constraint with branch ref shows key@branch"` -- entry has no constraint and ref "main"; expect `"owner/repo@main"` (unchanged)

**Edge Cases**:
- Constraint present with null ref (defensive): this should not occur under normal operation because constrained installs always resolve to a tag. However, if a manifest is manually edited or corrupted, the label should degrade gracefully to just `key  ^1.0` without an arrow or a null/undefined display.
- Non-constrained entries display identically: the constraint check is the first branch. When `entry.constraint` is `undefined`, execution falls through to the existing logic with zero behavioral change.

**Context**:
> The spec states (List Command Integration > Display): "Show the constraint alongside the current ref when present (e.g. `^1.0 -> v1.2.3`)". The arrow notation is taken directly from the spec. The `ManifestEntry.constraint` field is optional (`constraint?: string`) per Phase 2 task vc-2-1 -- its absence (undefined) signals no constraint.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "List Command Integration" (Display bullet)

## vc-4-2 | pending

### Task vc-4-2: Constraint-aware status hints in list view

**Problem**: The `formatStatusHint` function in `src/commands/list.ts` maps `UpdateCheckResult.status` to human-readable hint text displayed next to each plugin in the list view. It handles the five original statuses (`up-to-date`, `update-available`, `newer-tags`, `check-failed`, `local`) but has no cases for the three new constrained statuses added in Phase 3 (`constrained-update-available`, `constrained-up-to-date`, `constrained-no-match`). Without handling these, constrained plugins would either show no hint or produce a TypeScript exhaustiveness error.

**Solution**: Extend `formatStatusHint` to handle the three new constrained statuses with appropriate hint text that differentiates constraint-aware states from their non-constrained counterparts. For `constrained-up-to-date`, include out-of-constraint info when available (e.g. `"Up to date (v2.0.0 outside ^1.0)"`). For `constrained-update-available`, show the available tag. For `constrained-no-match`, show an error hint that the constraint has no matching tags.

**Outcome**: All eight `UpdateCheckResult` statuses produce meaningful, visually distinct hint text in the list view. Constrained statuses communicate both within-constraint status and out-of-constraint availability. Non-constrained statuses are completely unchanged.

**Do**:
- In `src/commands/list.ts`, extend the `formatStatusHint` function's switch statement with three new cases:
  ```typescript
  case "constrained-update-available": {
    const hint = `\u2191 Update available: ${result.tag}`;
    if (result.outOfConstraint) {
      return `${hint} (${result.outOfConstraint.latest} outside constraint)`;
    }
    return hint;
  }
  case "constrained-up-to-date": {
    if (result.outOfConstraint) {
      return `\u2713 Up to date (${result.outOfConstraint.latest} outside constraint)`;
    }
    return "\u2713 Up to date";
  }
  case "constrained-no-match":
    return `\u2717 No tags match ${result.constraint}`;
  ```
- The `constrained-update-available` hint includes the resolved tag name so the user can see what version is available without entering the detail view
- The `constrained-up-to-date` hint appends out-of-constraint info in parentheses when a newer version exists outside the constraint bounds, matching the spec's requirement to differentiate "update available within constraint" from "newer version outside constraint"
- The `constrained-no-match` hint uses the error icon and includes the constraint expression so the user understands why no match was found
- Ensure the switch is exhaustive -- TypeScript's exhaustive check should catch any missing cases. If the codebase uses a `default: never` pattern, verify it still works.
- The `UpdateCheckResult` type used by `formatStatusHint` must be the updated union from Phase 3 task vc-3-1 that includes the three new constrained members. Verify the import in `src/commands/list.ts` pulls from `../update-check.js`.

**Acceptance Criteria**:
- [ ] `constrained-update-available` shows `"Up arrow Update available: v1.1.0"` hint
- [ ] `constrained-update-available` with `outOfConstraint` appends `"(v2.0.0 outside constraint)"`
- [ ] `constrained-up-to-date` shows `"Checkmark Up to date"` hint
- [ ] `constrained-up-to-date` with `outOfConstraint` shows `"Checkmark Up to date (v2.0.0 outside constraint)"`
- [ ] `constrained-no-match` shows `"X No tags match ^1.0"` hint
- [ ] Non-constrained statuses (`up-to-date`, `update-available`, `newer-tags`, `check-failed`, `local`) produce identical hint text as before
- [ ] Switch is exhaustive -- all `UpdateCheckResult` statuses handled

**Tests**:
- `"formatStatusHint constrained-update-available shows tag"` -- result is `{ status: "constrained-update-available", tag: "v1.1.0", commit: "abc" }`; expect hint contains "Update available: v1.1.0"
- `"formatStatusHint constrained-update-available with outOfConstraint"` -- result includes `outOfConstraint: { latest: "v2.0.0" }`; expect hint contains "v2.0.0 outside constraint"
- `"formatStatusHint constrained-update-available without outOfConstraint"` -- result has no outOfConstraint; expect hint does NOT contain "outside constraint"
- `"formatStatusHint constrained-up-to-date without outOfConstraint"` -- result is `{ status: "constrained-up-to-date" }`; expect `"\u2713 Up to date"`
- `"formatStatusHint constrained-up-to-date with outOfConstraint"` -- result includes `outOfConstraint: { latest: "v3.0.0" }`; expect hint contains "v3.0.0 outside constraint"
- `"formatStatusHint constrained-no-match shows constraint"` -- result is `{ status: "constrained-no-match", constraint: "^3.0" }`; expect hint contains "No tags match ^3.0"
- `"formatStatusHint up-to-date unchanged"` -- result is `{ status: "up-to-date" }`; expect `"\u2713 Up to date"` (identical to before)
- `"formatStatusHint update-available unchanged"` -- result is `{ status: "update-available", remoteCommit: "abc" }`; expect `"\u2191 Update available"` (identical to before)
- `"formatStatusHint newer-tags unchanged"` -- result is `{ status: "newer-tags", tags: ["v2.0"] }`; expect `"\u2691 Newer tags available"` (identical to before)
- `"formatStatusHint check-failed unchanged"` -- result is `{ status: "check-failed", reason: "err" }`; expect `"\u2717 Check failed"` (identical to before)
- `"formatStatusHint local unchanged"` -- result is `{ status: "local" }`; expect `"\u25CF Local"` (identical to before)

**Edge Cases**:
- Constrained-up-to-date with out-of-constraint info: the hint must communicate that the plugin is up to date *within its constraint* but a newer major version exists outside. The parenthetical `"(v2.0.0 outside constraint)"` conveys this without implying the user needs to act.
- Constrained-no-match shows meaningful hint: when no tags satisfy the constraint (e.g. `^3.0` but only `v1.x` and `v2.x` exist), the hint includes the constraint expression so the user can understand the mismatch without entering the detail view.
- Non-constrained statuses unchanged: the five original cases in the switch are left completely untouched. Only new cases are added.

**Context**:
> The spec states (List Command Integration > Update status): "Differentiate between 'update available within constraint' and 'newer version outside constraint' -- same distinction as the update output info line." The three new constrained statuses from Phase 3 task vc-3-1 (`constrained-update-available`, `constrained-up-to-date`, `constrained-no-match`) carry the data needed: the resolved tag, the optional `outOfConstraint.latest`, and the constraint string.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "List Command Integration" (Update status bullet)

## vc-4-3 | pending

### Task vc-4-3: Constraint-aware detail view actions

**Problem**: The `getActions` function in `src/commands/list-detail.ts` determines which actions are available in the detail view based on `UpdateCheckResult.status`. It handles the five original statuses but has no cases for the three new constrained statuses. Without these, selecting a constrained plugin in the detail view would either show no actions or cause a TypeScript error. The actions offered must reflect constraint-aware semantics -- for example, `constrained-up-to-date` with out-of-constraint info should offer "Change version" (to break out of the constraint), while `constrained-no-match` should only offer "Remove" and "Back" since the plugin is in an error state.

**Solution**: Extend `getActions` in `src/commands/list-detail.ts` to handle the three new constrained statuses with appropriate action sets. Also pass the full `UpdateCheckResult` to `getActions` (instead of just the status string) so it can inspect `outOfConstraint` to determine whether "Change version" should be offered. Add informational messages in `renderDetailView` for constrained statuses that provide context (e.g. constraint-no-match explains why no tags matched).

**Outcome**: Each constrained status produces the correct set of actions. `constrained-update-available` offers Update/Change version/Remove/Back. `constrained-up-to-date` offers Change version/Remove/Back only when out-of-constraint info exists (otherwise just Remove/Back). `constrained-no-match` offers only Remove/Back with an error message. Non-constrained statuses produce identical action sets as before.

**Do**:
- In `src/commands/list-detail.ts`, change `getActions` to accept the full `UpdateCheckResult` instead of just the status string:
  ```typescript
  function getActions(
    result: UpdateCheckResult,
  ): Array<{ value: DetailAction; label: string }> {
  ```
- Update the call site in `renderDetailView` from `getActions(updateStatus.status)` to `getActions(updateStatus)`.
- Add cases for the three new constrained statuses in the switch:
  ```typescript
  case "constrained-update-available":
    return [
      { value: "update", label: "Update" },
      { value: "change-version", label: "Change version" },
      { value: "remove", label: "Remove" },
      { value: "back", label: "Back" },
    ];
  case "constrained-up-to-date":
    if (result.outOfConstraint) {
      return [
        { value: "change-version", label: "Change version" },
        { value: "remove", label: "Remove" },
        { value: "back", label: "Back" },
      ];
    }
    return [
      { value: "remove", label: "Remove" },
      { value: "back", label: "Back" },
    ];
  case "constrained-no-match":
    return [
      { value: "remove", label: "Remove" },
      { value: "back", label: "Back" },
    ];
  ```
- For `constrained-update-available`: offers Update (to update within constraint bounds), Change version (to break out of constraint by picking a specific tag), Remove, and Back.
- For `constrained-up-to-date` WITHOUT out-of-constraint: the plugin is at the best version within its constraint and no newer versions exist anywhere. Only Remove and Back are useful -- there is nothing to change to.
- For `constrained-up-to-date` WITH out-of-constraint: the plugin is at the best version within its constraint but a newer major version exists outside. Offer Change version so the user can jump to the newer version (which removes the constraint per vc-4-4). Remove and Back also available.
- For `constrained-no-match`: the plugin's constraint matches no remote tags. This is an error state. Show an informational message explaining the situation. Only Remove and Back are offered since there is nothing to update or change to within the constraint system.
- In `renderDetailView`, add contextual messages before the action prompt for constrained error/info states:
  ```typescript
  if (updateStatus.status === "constrained-no-match") {
    p.log.error(`No remote tags satisfy constraint ${updateStatus.constraint}`);
  }
  if (updateStatus.status === "constrained-up-to-date" && updateStatus.outOfConstraint) {
    p.log.info(`${updateStatus.outOfConstraint.latest} available outside constraint ${entry.constraint}`);
  }
  if (updateStatus.status === "constrained-update-available" && updateStatus.outOfConstraint) {
    p.log.info(`${updateStatus.outOfConstraint.latest} available outside constraint ${entry.constraint}`);
  }
  ```
- Update the switch inside `getActions` to use `result.status` instead of the raw `status` parameter:
  ```typescript
  switch (result.status) {
  ```
- Ensure all existing cases still use `result.status` and work correctly.

**Acceptance Criteria**:
- [ ] `constrained-update-available` offers Update, Change version, Remove, Back
- [ ] `constrained-up-to-date` without `outOfConstraint` offers Remove, Back only (no Change version since there is nothing outside the constraint to change to)
- [ ] `constrained-up-to-date` with `outOfConstraint` offers Change version, Remove, Back
- [ ] `constrained-no-match` offers Remove, Back only
- [ ] `constrained-no-match` displays error message with constraint expression
- [ ] `constrained-up-to-date` with out-of-constraint displays info message with latest version
- [ ] `constrained-update-available` with out-of-constraint displays info message with latest version
- [ ] Non-constrained statuses (`up-to-date`, `update-available`, `newer-tags`, `check-failed`, `local`) produce identical action sets as before

**Tests**:
- `"getActions constrained-update-available returns update, change-version, remove, back"` -- result is constrained-update-available with tag "v1.1.0"; expect actions in order: update, change-version, remove, back
- `"getActions constrained-up-to-date without outOfConstraint returns remove, back"` -- result is constrained-up-to-date with no outOfConstraint; expect actions: remove, back
- `"getActions constrained-up-to-date with outOfConstraint returns change-version, remove, back"` -- result is constrained-up-to-date with outOfConstraint { latest: "v2.0.0" }; expect actions: change-version, remove, back
- `"getActions constrained-no-match returns remove, back"` -- result is constrained-no-match with constraint "^3.0"; expect actions: remove, back
- `"getActions up-to-date unchanged"` -- result is up-to-date; expect actions: remove, back (identical to before)
- `"getActions update-available unchanged"` -- result is update-available; expect actions: update, remove, back (identical to before)
- `"getActions newer-tags unchanged"` -- result is newer-tags; expect actions: change-version, remove, back (identical to before)
- `"getActions check-failed unchanged"` -- result is check-failed; expect actions: remove, back (identical to before)
- `"getActions local unchanged"` -- result is local; expect actions: update, remove, back (identical to before)
- `"renderDetailView shows error for constrained-no-match"` -- mock renderDetailView with constrained-no-match; verify p.log.error called with message containing the constraint
- `"renderDetailView shows info for constrained-up-to-date with outOfConstraint"` -- mock renderDetailView with constrained-up-to-date and outOfConstraint; verify p.log.info called with message containing latest version

**Edge Cases**:
- Constrained-up-to-date with no out-of-constraint (no change-version): when the within-constraint best IS the absolute latest, there are no newer versions anywhere. The "Change version" action would be pointless since the only versions available are older. Only Remove and Back are offered.
- Constrained-no-match (error info + remove/back only): this is an error state where the user's constraint (e.g. `^3.0`) does not match any remote tags. The detail view shows an error message explaining the mismatch. The only useful actions are Remove (to get rid of the broken entry) or Back. No update or change-version is possible since there are no matching tags.
- Non-constrained statuses unchanged: the five original cases produce exactly the same action arrays as before. The refactor from `status: string` to `result: UpdateCheckResult` is transparent since the switch uses `result.status`.

**Context**:
> The spec states (List Command Integration > Change version action): "The existing change-version action operates outside the constraint system -- it allows the user to pick any available tag. Selecting a specific tag via the list action is equivalent to re-adding with an exact pin, removing the constraint." This means Change version is appropriate when there are tags to choose from (constrained-update-available, constrained-up-to-date with out-of-constraint) but not when in an error state (constrained-no-match). The `getActions` refactor to accept the full `UpdateCheckResult` enables inspecting `outOfConstraint` to make this determination.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "List Command Integration" (Update status bullet, Change version action bullet)

## vc-4-4 | pending

### Task vc-4-4: Change-version action removes constraint

**Problem**: The `executeChangeVersionAction` function in `src/commands/list-change-version-action.ts` lets users pick a specific tag from the list of available tags and reinstalls the plugin at that tag. Currently, it does not interact with the constraint system at all. The spec requires that selecting a specific tag via the change-version action is equivalent to re-adding with an exact pin -- meaning the `constraint` field must be removed from the manifest entry after the reinstall. Additionally, the function currently only works when `updateStatus.status === "newer-tags"` and needs to work with the new constrained status types that also carry tag information.

**Solution**: Extend `executeChangeVersionAction` to: (1) support the new constrained status types that carry tag lists or from which tags can be derived, (2) remove the `constraint` field from the resulting manifest entry after a successful change-version operation. The constraint removal is done by explicitly setting `constraint` to `undefined` on the new manifest entry returned by `cloneAndReinstall` (since the nuke-reinstall pipeline preserves constraint from the existing entry, we must actively strip it).

**Outcome**: When a user selects a specific tag via the change-version action on a constrained plugin, the constraint is removed from the manifest entry. The plugin becomes an exact pin at the selected tag. When the entry already has no constraint, the behavior is unchanged. The action works with both old (`newer-tags`) and new (`constrained-update-available`, `constrained-up-to-date`) status types.

**Do**:
- In `src/commands/list-change-version-action.ts`, change the status guard at the top of `executeChangeVersionAction` to accept the new constrained statuses that carry tag data. The current guard only accepts `"newer-tags"`:
  ```typescript
  if (updateStatus.status !== "newer-tags") {
    return { changed: false, message: "No tags available for version change" };
  }
  ```
  Replace with a function that extracts tags from any status that supports change-version:
  ```typescript
  const tags = extractTagsForChangeVersion(updateStatus);
  if (tags === null) {
    return { changed: false, message: "No tags available for version change" };
  }
  ```
- Implement a `fetchAllTags` helper in `src/commands/list-change-version-action.ts` that fetches all tags via ls-remote for constrained statuses (which do not carry a full tag list in their `UpdateCheckResult`):
  ```typescript
  async function fetchAllTags(key: string, cloneUrl: string | null): Promise<string[]> {
    const url = deriveCloneUrlFromKey(key, cloneUrl);
    const { stdout } = await execGit(["ls-remote", "--tags", url], { timeout: 15_000 });
    return parseAllTags(stdout);
  }
  ```
  Import `deriveCloneUrlFromKey` from `../source-parser.js`, `execGit` from `../git-utils.js`, and `parseAllTags` from `../update-check.js` (export it from `update-check.ts` if not already exported).
- Replace the existing status guard at the top of `executeChangeVersionAction` with tag extraction logic that handles both old and new status types:
  ```typescript
  let tags: string[];
  if (updateStatus.status === "newer-tags") {
    tags = [...updateStatus.tags].reverse();
  } else if (
    updateStatus.status === "constrained-update-available" ||
    updateStatus.status === "constrained-up-to-date"
  ) {
    const allTags = await fetchAllTags(key, entry.cloneUrl);
    tags = [...allTags].reverse();
  } else {
    return { changed: false, message: "No tags available for version change" };
  }
  ```
- After a successful `cloneAndReinstall`, strip the constraint from the resulting manifest entry before writing:
  ```typescript
  const result = await cloneAndReinstall({
    key,
    entry,
    projectDir,
    newRef: selectedTag,
    manifest,
  });

  if (result.status === "failed") {
    const message = buildFailureMessage(result, key, { isChangeVersion: true });
    return { changed: false, message };
  }

  // Remove constraint -- selecting a specific tag is an exact pin
  const newEntry: ManifestEntry = { ...result.manifestEntry };
  delete newEntry.constraint;

  const updated = addEntry(manifest, key, newEntry);
  await writeManifest(projectDir, updated);
  ```
  Using `delete newEntry.constraint` ensures the field is absent from the object. When serialized with `JSON.stringify`, absent properties are omitted.
- Export `parseAllTags` from `src/update-check.ts` so it can be imported by the change-version action. Alternatively, move it to a shared utility. The simplest approach: add `export` to the existing `parseAllTags` function in `update-check.ts`.
- Update the function signature to accept additional parameters if needed. The current signature already has `key` and `entry` (which contains `cloneUrl`), so no new parameters are needed for tag fetching.

**Acceptance Criteria**:
- [ ] Change-version on a constrained entry removes the `constraint` field from the resulting manifest entry
- [ ] The written manifest JSON does not contain the `"constraint"` key for the changed entry
- [ ] Change-version on an entry that already has no constraint does not add or modify any constraint field (no-op on constraint -- existing behavior preserved)
- [ ] Change-version works with `newer-tags` status (existing behavior preserved)
- [ ] Change-version works with `constrained-update-available` status (fetches all tags, presents selection)
- [ ] Change-version works with `constrained-up-to-date` status with `outOfConstraint` (fetches all tags, presents selection)
- [ ] Selecting the same tag as current ref returns "Already on this version" (existing behavior)
- [ ] User cancellation returns "Cancelled" (existing behavior)

**Tests**:
- `"change-version on constrained entry removes constraint from manifest"` -- entry has constraint "^1.0" and ref "v1.0.0"; mock updateStatus as constrained-update-available; mock tag fetch returning ["v1.0.0", "v1.1.0", "v2.0.0"]; user selects "v2.0.0"; mock cloneAndReinstall success; verify writeManifest called with entry where `constraint` is `undefined` (absent)
- `"change-version on non-constrained entry does not add constraint"` -- entry has no constraint; mock updateStatus as newer-tags with tags ["v2.0.0"]; user selects "v2.0.0"; mock cloneAndReinstall success; verify writeManifest called with entry where `constraint` is `undefined`
- `"change-version with constrained-up-to-date fetches all tags"` -- entry has constraint "^1.0"; mock updateStatus as constrained-up-to-date with outOfConstraint; mock ls-remote returning tags; verify tag list is presented to user
- `"change-version with newer-tags uses tags from status"` -- entry has no constraint; mock updateStatus as newer-tags with tags ["v1.1.0", "v2.0.0"]; verify no ls-remote call made; tags presented directly
- `"change-version selecting same tag returns already on version"` -- entry has ref "v1.0.0"; user selects "v1.0.0"; expect { changed: false, message: "Already on this version" }
- `"change-version user cancellation returns cancelled"` -- user cancels selection prompt; expect { changed: false, message: "Cancelled" }
- `"change-version cloneAndReinstall failure preserves original entry"` -- mock cloneAndReinstall returning failure; verify writeManifest not called; original entry unchanged
- `"change-version on constrained entry with tilde constraint removes it"` -- entry has constraint "~1.2"; mock successful change; verify resulting entry has no constraint
- `"written manifest JSON excludes constraint key after change-version"` -- after change-version on constrained entry; serialize the manifest entry; verify JSON string does not contain "constraint"

**Edge Cases**:
- Entry already has no constraint (no-op): when `entry.constraint` is undefined, the `delete newEntry.constraint` operation is a no-op. The entry never had a constraint, and the resulting entry continues to not have one. Existing behavior is completely preserved.
- Entry with constraint and user selects tag (constraint removed): the core case. The nuke-reinstall pipeline preserves `constraint` from the existing entry (Phase 2 vc-2-1), but the change-version action must actively strip it because selecting a specific tag is an explicit exact pin. The `delete` operation after cloneAndReinstall handles this.
- Works with new constrained status types: the function must handle both `constrained-update-available` and `constrained-up-to-date` (with outOfConstraint). For both, it fetches all tags via ls-remote since the constrained `UpdateCheckResult` types do not carry a full tag list. The tag list is presented to the user for selection.

**Context**:
> The spec states (List Command Integration > Change version action): "The existing change-version action operates outside the constraint system -- it allows the user to pick any available tag. Selecting a specific tag via the list action is equivalent to re-adding with an exact pin, removing the constraint." This means: (1) the user sees ALL available tags, not just those within the constraint, (2) selecting a tag removes the constraint, and (3) the result is identical to `agntc add owner/repo@v1.2.3` (exact pin, no constraint). The nuke-reinstall pipeline automatically preserves constraint from the existing entry, so we must explicitly strip it after the reinstall.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "List Command Integration" (Change version action bullet)
