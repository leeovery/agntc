---
status: complete
created: 2026-03-24
cycle: 1
phase: Plan Integrity Review
topic: Version Constraints
---

# Review Tracking: Version Constraints - Integrity

## Findings

### 1. API signature mismatch: resolveVersion/resolveLatestVersion encapsulate normalization in vc-1-7 but callers in Phases 2-3 normalize externally

**Severity**: Critical
**Plan Reference**: Phase 1 / vc-1-7, Phase 2 / vc-2-2, Phase 2 / vc-2-3, Phase 3 / vc-3-1
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
Task vc-1-7 defines `resolveVersion(constraint: string, tags: string[]): ResolvedVersion | null` and `resolveLatestVersion(tags: string[]): ResolvedVersion | null` where both functions normalize raw tags internally (calling `normalizeTags` then `maxSatisfying`). However, tasks vc-2-2, vc-2-3, and vc-3-1 all normalize tags externally first via `normalizeTags()`, then pass the result to these functions with swapped parameter order:

- vc-2-2 Do step 3: `resolveLatestVersion(normalizedTags)` -- passes a Map, but function expects string[]
- vc-2-3 Do step 3: `resolveVersion(normalizedTags, parsed.constraint)` -- parameter order swapped AND passes Map instead of string[]
- vc-3-1 Do step 4: `resolveVersion(normalizedTags, constraint)` -- same issues

This is a design conflict: vc-1-7 encapsulates normalization (caller passes raw tags), but Phases 2-3 expect externally-normalized data (caller passes a Map). The external normalization pattern is the better design because vc-3-1's `checkConstrained` needs to call both `resolveVersion` and `resolveLatestVersion` with the same normalized data (normalize once, use twice). The fix is to change vc-1-7's API to accept pre-normalized data.

An implementer following vc-1-7 would build functions that normalize internally, then hit Phase 2 tasks that call those functions with already-normalized Maps -- a type error and logic bug.

**Current**:
From vc-1-7 Do section:

```
- In `src/version-resolve.ts`, define a result type: `interface ResolvedVersion { tag: string; version: string }` where `tag` is the original git tag name (for use as a ref in clone) and `version` is the cleaned semver string
- Implement `resolveVersion(constraint: string, tags: string[]): ResolvedVersion | null` with this algorithm:
  1. Call `normalizeTags(tags)` to get the `Map<string, string>` (cleaned version -> original tag)
  2. Extract the cleaned versions as an array: `Array.from(map.keys())`
  3. Call `semver.maxSatisfying(cleanedVersions, constraint)` -- this returns the highest version that satisfies the constraint, or `null`
  4. If `maxSatisfying` returns `null`, return `null` (no match)
  5. Look up the original tag name from the map using the matched version
  6. Return `{ tag: originalTag, version: matchedVersion }`
- Also implement `resolveLatestVersion(tags: string[]): ResolvedVersion | null` for the bare-add case (Phase 2 will use it, but it belongs in this module):
  1. Call `normalizeTags(tags)` to get the map
  2. Call `semver.maxSatisfying(cleanedVersions, "*")` -- `*` matches all stable versions, excluding pre-release
  3. If null, return null
  4. Map back to original tag and return `{ tag, version }`
- Export both functions
- Add tests to `tests/version-resolve.test.ts`
```

**Proposed**:
Replace the Do section items for resolveVersion and resolveLatestVersion in vc-1-7:

```
- In `src/version-resolve.ts`, define a result type: `interface ResolvedVersion { original: string; cleaned: string }` where `original` is the original git tag name (for use as a ref in clone) and `cleaned` is the cleaned semver string
- Define an input type for normalized tags: `interface NormalizedTag { original: string; cleaned: string }` -- this is the output shape from `normalizeTags` (update vc-1-6's return type from `Map<string, string>` to `NormalizedTag[]` accordingly, or convert here)
- Implement `resolveVersion(normalizedTags: NormalizedTag[], constraint: string): ResolvedVersion | null` with this algorithm:
  1. Extract the cleaned versions as an array: `normalizedTags.map(t => t.cleaned)`
  2. Call `semver.maxSatisfying(cleanedVersions, constraint)` -- this returns the highest version that satisfies the constraint, or `null`
  3. If `maxSatisfying` returns `null`, return `null` (no match)
  4. Find the normalized tag whose `cleaned` matches the result
  5. Return `{ original: tag.original, cleaned: matchedVersion }`
- Also implement `resolveLatestVersion(normalizedTags: NormalizedTag[]): ResolvedVersion | null` for the bare-add case (Phase 2 will use it, but it belongs in this module):
  1. Call `semver.maxSatisfying(normalizedTags.map(t => t.cleaned), "*")` -- `*` matches all stable versions, excluding pre-release
  2. If null, return null
  3. Find the normalized tag whose `cleaned` matches and return `{ original, cleaned }`
- Export both functions and the `ResolvedVersion` and `NormalizedTag` types
- Add tests to `tests/version-resolve.test.ts`
```

Also update vc-1-7 Acceptance Criteria to reflect the new signatures:

Current:
```
- [ ] `resolveVersion("^1.0", ["v1.0.0", "v1.1.0", "v2.0.0"])` returns `{ tag: "v1.1.0", version: "1.1.0" }`
- [ ] `resolveVersion("~1.0.0", ["v1.0.0", "v1.0.5", "v1.1.0"])` returns `{ tag: "v1.0.5", version: "1.0.5" }`
- [ ] `resolveVersion("^3.0", ["v1.0.0", "v2.0.0"])` returns `null`
- [ ] `resolveVersion("^0.2.3", ["v0.2.3", "v0.2.5", "v0.3.0"])` returns `{ tag: "v0.2.5", version: "0.2.5" }` (pre-1.0 caret: `^0.2.3` -> `>=0.2.3, <0.3.0`)
- [ ] `resolveVersion("^0.0.3", ["v0.0.3", "v0.0.4", "v0.1.0"])` returns `{ tag: "v0.0.3", version: "0.0.3" }` (pre-1.0 caret: `^0.0.3` -> `>=0.0.3, <0.0.4`)
- [ ] `resolveVersion("^1", ["v1.0.0", "v1.5.0", "v2.0.0"])` returns `{ tag: "v1.5.0", version: "1.5.0" }` (partial constraint)
- [ ] `resolveLatestVersion(["v1.0.0", "v2.0.0", "v2.0.0-beta.1"])` returns `{ tag: "v2.0.0", version: "2.0.0" }` (pre-release excluded)
- [ ] `resolveLatestVersion(["alpha", "beta"])` returns `null` (no semver tags)
- [ ] Pre-release tags are excluded by `maxSatisfying` for non-pre-release constraints
- [ ] The returned `tag` is the original git ref name (e.g., `"v1.1.0"`, not `"1.1.0"`)
```

Proposed:
```
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.1.0", "v2.0.0"]), "^1.0")` returns `{ original: "v1.1.0", cleaned: "1.1.0" }`
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.0.5", "v1.1.0"]), "~1.0.0")` returns `{ original: "v1.0.5", cleaned: "1.0.5" }`
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v2.0.0"]), "^3.0")` returns `null`
- [ ] `resolveVersion(normalizeTags(["v0.2.3", "v0.2.5", "v0.3.0"]), "^0.2.3")` returns `{ original: "v0.2.5", cleaned: "0.2.5" }` (pre-1.0 caret: `^0.2.3` -> `>=0.2.3, <0.3.0`)
- [ ] `resolveVersion(normalizeTags(["v0.0.3", "v0.0.4", "v0.1.0"]), "^0.0.3")` returns `{ original: "v0.0.3", cleaned: "0.0.3" }` (pre-1.0 caret: `^0.0.3` -> `>=0.0.3, <0.0.4`)
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.5.0", "v2.0.0"]), "^1")` returns `{ original: "v1.5.0", cleaned: "1.5.0" }` (partial constraint)
- [ ] `resolveLatestVersion(normalizeTags(["v1.0.0", "v2.0.0", "v2.0.0-beta.1"]))` returns `{ original: "v2.0.0", cleaned: "2.0.0" }` (pre-release excluded)
- [ ] `resolveLatestVersion(normalizeTags(["alpha", "beta"]))` returns `null` (no semver tags -- normalizeTags returns empty)
- [ ] Pre-release tags are excluded by `maxSatisfying` for non-pre-release constraints
- [ ] The returned `original` is the original git ref name (e.g., `"v1.1.0"`, not `"1.1.0"`)
```

Also update vc-1-7 Tests section correspondingly -- every test that calls `resolveVersion(constraint, rawTags)` should instead call `resolveVersion(normalizeTags(rawTags), constraint)`, and return field names change from `tag`/`version` to `original`/`cleaned`.

Also update vc-1-7 Context to note that callers in Phases 2-3 normalize externally and pass the result, so these functions must accept pre-normalized data.

**Resolution**: Fixed
**Notes**: This also requires a corresponding update to vc-1-6 to either change `normalizeTags` return type from `Map<string, string>` to `NormalizedTag[]`, or to add a conversion step in vc-1-7. The Map return type works for internal use but the array-of-objects pattern is cleaner for the callers. The vc-3-1 Do section references `resolvedResult.original` and `resolvedResult.cleaned` which already assumes this naming -- further evidence that the `original`/`cleaned` naming is the intended design.

---

### 2. vc-4-4 Do section contains exploratory deliberation rather than a clear implementation path

**Severity**: Important
**Plan Reference**: Phase 4 / vc-4-4
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
The Do section of vc-4-4 walks through an initial approach for `extractTagsForChangeVersion` that returns `null` for constrained statuses, then pivots mid-section to "Important consideration" and "Approach A (preferred)" that fetches tags directly. The initial code block shows a function that does NOT work for constrained statuses (returns null), then the task explains why it does not work and proposes a different approach. An implementer reading this sequentially would be confused about which approach to follow.

The task should present only the final approach (Approach A) and remove the deliberation. The current structure forces the implementer to read through dead-end reasoning to find the actual implementation plan.

**Current**:
From vc-4-4 Do section (the problematic portion):

```
- Implement `extractTagsForChangeVersion` as a helper function:
  ```typescript
  function extractTagsForChangeVersion(status: UpdateCheckResult): string[] | null {
    switch (status.status) {
      case "newer-tags":
        return status.tags;
      case "constrained-update-available":
      case "constrained-up-to-date":
        // For constrained statuses, we need to fetch all tags
        // However, the UpdateCheckResult for constrained statuses does not carry
        // the full tag list -- only the resolved tag and outOfConstraint info.
        // We need to pass the tag list through from the update check.
        // See alternative approach below.
        return null;
      default:
        return null;
    }
  }
  ```
  **Important consideration**: The constrained `UpdateCheckResult` types from Phase 3 (vc-3-1) do NOT carry a full tag list -- they only carry the resolved tag name and optional out-of-constraint info. The `newer-tags` status carries `tags: string[]` because the old `checkTag` path collects them. For the constrained change-version action to work, we need access to all available tags. There are two approaches:

  **Approach A (preferred)**: Fetch tags directly in `executeChangeVersionAction` when the status is a constrained type. The function already has access to the manifest `key` from which the clone URL can be derived. Use `ls-remote --tags` to fetch all tags, similar to how `checkTag` does it. This keeps the `UpdateCheckResult` types clean and avoids passing large tag arrays through the status.

  ```typescript
  async function fetchAllTags(key: string, cloneUrl: string | null): Promise<string[]> {
    const url = deriveCloneUrlFromKey(key, cloneUrl);
    const { stdout } = await execGit(["ls-remote", "--tags", url], { timeout: 15_000 });
    return parseAllTags(stdout);
  }
  ```

  Import `deriveCloneUrlFromKey` from `../source-parser.js`, `execGit` from `../git-utils.js`. The `parseAllTags` helper is currently private in `update-check.ts` -- either export it or duplicate the simple parsing logic.

- Rewrite the tag extraction logic:
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
```

**Proposed**:
Replace the tag extraction portion of vc-4-4 Do section with a clean, linear implementation path:

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
  The `newer-tags` status carries tags directly from Phase 3's `checkTag` path. The constrained statuses do not carry a full tag list (only the resolved tag and optional out-of-constraint info), so tags are fetched on demand via ls-remote.
- Export `parseAllTags` from `src/update-check.ts` so it can be imported by the change-version action
```

**Resolution**: Fixed
**Notes**:

---

### 3. vc-1-6 normalizeTags return type (Map) vs vc-1-7/vc-3-1 usage pattern (needs original+cleaned pairs)

**Severity**: Important
**Plan Reference**: Phase 1 / vc-1-6
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
Task vc-1-6 defines `normalizeTags` as returning `Map<string, string>` (cleaned version -> original tag). However, vc-3-1's Do section references `resolvedResult.original` and `resolvedResult.cleaned` on the output of resolution functions, and the proposed fix for Finding 1 introduces `NormalizedTag { original: string; cleaned: string }`. The Map return type creates friction: callers must iterate Map entries to build arrays for `maxSatisfying`, and the key-value semantics (cleaned->original) require mental inversion when reading code.

Returning `NormalizedTag[]` (array of `{ original, cleaned }` objects) is more ergonomic for callers and aligns with how vc-3-1 already uses the data. The duplicate-handling logic (prefer v-prefix) works identically with either data structure.

This finding is related to Finding 1 but targets vc-1-6 specifically, whereas Finding 1 targets vc-1-7.

**Current**:
From vc-1-6 Solution:

```
Create a new module `src/version-resolve.ts` with a `normalizeTags()` function that implements the tag normalization pipeline described in the spec. The function takes an array of raw tag strings (as returned from `git ls-remote --tags`) and returns a `Map<string, string>` mapping cleaned semver versions to their original tag names. This map is the input for `semver.maxSatisfying()` in the next task.
```

From vc-1-6 Do section algorithm:

```
- Implement `normalizeTags(tags: string[]): Map<string, string>` with this algorithm:
  1. Create an empty `Map<string, string>` (cleaned version -> original tag)
  2. For each tag in the input array:
     a. Call `semver.clean(tag)` -- this strips `v` prefix and whitespace (e.g., `v1.2.3` -> `"1.2.3"`, `" v1.2.3 "` -> `"1.2.3"`)
     b. If `clean()` returns `null`, skip this tag (not valid semver)
     c. If the cleaned version is already in the map, apply the preference rule: prefer `v`-prefixed tags over non-prefixed. Specifically, if the new tag starts with `v` and the existing mapped tag does not, overwrite. Otherwise, keep the existing mapping
     d. If the cleaned version is not in the map, add it
  3. Return the map
```

From vc-1-6 Outcome:

```
`normalizeTags(["v1.2.3", "1.0.0", "release-candidate", "latest"])` returns a Map with entries `"1.2.3" -> "v1.2.3"` and `"1.0.0" -> "1.0.0"`. Non-semver tags are excluded. Duplicate versions prefer the `v`-prefixed form.
```

**Proposed**:
Update vc-1-6 Solution:

```
Create a new module `src/version-resolve.ts` with a `normalizeTags()` function that implements the tag normalization pipeline described in the spec. The function takes an array of raw tag strings (as returned from `git ls-remote --tags`) and returns a `NormalizedTag[]` array where each entry pairs the original tag name with its cleaned semver version. This array is the input for `resolveVersion()` and `resolveLatestVersion()` in the next task.
```

Update vc-1-6 Do section algorithm:

```
- Define `export interface NormalizedTag { original: string; cleaned: string }` in `src/version-resolve.ts`
- Implement `normalizeTags(tags: string[]): NormalizedTag[]` with this algorithm:
  1. Create an empty `Map<string, NormalizedTag>` (cleaned version -> NormalizedTag) as an intermediate deduplication structure
  2. For each tag in the input array:
     a. Call `semver.clean(tag)` -- this strips `v` prefix and whitespace (e.g., `v1.2.3` -> `"1.2.3"`, `" v1.2.3 "` -> `"1.2.3"`)
     b. If `clean()` returns `null`, skip this tag (not valid semver)
     c. If the cleaned version is already in the map, apply the preference rule: prefer `v`-prefixed tags over non-prefixed. Specifically, if the new tag starts with `v` and the existing mapped tag does not, overwrite with `{ original: tag, cleaned }`. Otherwise, keep the existing entry
     d. If the cleaned version is not in the map, add `{ original: tag, cleaned }`
  3. Return `Array.from(map.values())`
```

Update vc-1-6 Outcome:

```
`normalizeTags(["v1.2.3", "1.0.0", "release-candidate", "latest"])` returns `[{ original: "v1.2.3", cleaned: "1.2.3" }, { original: "1.0.0", cleaned: "1.0.0" }]`. Non-semver tags are excluded. Duplicate versions prefer the `v`-prefixed form.
```

Update vc-1-6 Acceptance Criteria correspondingly:

Current:
```
- [ ] `normalizeTags(["v1.2.3"])` returns Map `{ "1.2.3" => "v1.2.3" }`
- [ ] `normalizeTags(["1.0.0"])` returns Map `{ "1.0.0" => "1.0.0" }`
- [ ] `normalizeTags(["v1.2.3", "1.2.3"])` returns Map `{ "1.2.3" => "v1.2.3" }` (v-prefix preferred)
- [ ] `normalizeTags(["1.2.3", "v1.2.3"])` returns Map `{ "1.2.3" => "v1.2.3" }` (v-prefix preferred regardless of order)
- [ ] `normalizeTags(["release-candidate", "latest", "nope"])` returns empty Map
- [ ] `normalizeTags([])` returns empty Map
- [ ] `normalizeTags(["v1.0.0", "v2.0.0", "latest"])` returns Map with 2 entries (semver tags only)
- [ ] Non-semver tags like `release-candidate`, `latest`, `nope` are excluded
- [ ] Tags with extra whitespace are cleaned (e.g., `" v1.2.3 "` -> `"1.2.3"`)
```

Proposed:
```
- [ ] `normalizeTags(["v1.2.3"])` returns `[{ original: "v1.2.3", cleaned: "1.2.3" }]`
- [ ] `normalizeTags(["1.0.0"])` returns `[{ original: "1.0.0", cleaned: "1.0.0" }]`
- [ ] `normalizeTags(["v1.2.3", "1.2.3"])` returns one entry with `original: "v1.2.3"` (v-prefix preferred)
- [ ] `normalizeTags(["1.2.3", "v1.2.3"])` returns one entry with `original: "v1.2.3"` (v-prefix preferred regardless of order)
- [ ] `normalizeTags(["release-candidate", "latest", "nope"])` returns empty array
- [ ] `normalizeTags([])` returns empty array
- [ ] `normalizeTags(["v1.0.0", "v2.0.0", "latest"])` returns 2 entries (semver tags only)
- [ ] Non-semver tags like `release-candidate`, `latest`, `nope` are excluded
- [ ] Tags with extra whitespace are cleaned (e.g., `" v1.2.3 "` -> cleaned: `"1.2.3"`)
```

Update vc-1-6 Tests section correspondingly -- change Map assertions to array-of-objects assertions with `original`/`cleaned` fields.

**Resolution**: Fixed
**Notes**: This finding is a prerequisite for Finding 1. The `NormalizedTag` type defined here is what `resolveVersion` and `resolveLatestVersion` accept in the updated vc-1-7 signatures.
