---
phase: 2
phase_name: Add Command with Constraints
total: 5
---

## vc-2-1 | pending

### Task vc-2-1: Extend ManifestEntry with optional constraint field

**Problem**: The `ManifestEntry` interface in `src/manifest.ts` has no `constraint` field. The version constraints feature requires each manifest entry to optionally carry the constraint expression (e.g. `^1.0`, `~1.2`) so the update command can resolve within bounds and the list command can display constraint info. Without this field, constrained installs have no way to persist user intent.

**Solution**: Add an optional `constraint?: string` field to the `ManifestEntry` interface. The field is *optional* (not `string | null`) — its absence is the signal that no constraint is active, matching the spec's "no sentinel value" design. Update `readManifest` to handle old manifests that lack the field gracefully (no backfill needed since TypeScript optional fields are `undefined` when absent, which is the desired behavior). Verify that `writeManifest` serializes correctly — `JSON.stringify` omits `undefined` properties, so unconstrained entries naturally exclude the field from disk.

**Outcome**: `ManifestEntry` has an optional `constraint` field. Old manifests without it read correctly and behave identically. New entries can include a constraint string. All existing tests pass unchanged.

**Do**:
- In `src/manifest.ts`, add `constraint?: string;` to the `ManifestEntry` interface, positioned before `ref` (since constraint represents user intent, while ref/commit represent resolved state)
- Verify that `readManifest` needs no changes — the existing JSON parse naturally produces objects without the `constraint` key for old manifests, and TypeScript optional fields accept this
- Verify that `writeManifest` needs no changes — `JSON.stringify` omits `undefined` properties, so entries without `constraint` set will not include it in the serialized output
- In `src/nuke-reinstall-pipeline.ts`, update the `ManifestEntry` construction in `executeNukeAndReinstall` to forward `constraint` from the existing entry: `constraint: existingEntry.constraint` (so update preserves the constraint)
- Run `pnpm test` to confirm all existing tests pass

**Acceptance Criteria**:
- [ ] `ManifestEntry` interface includes `constraint?: string`
- [ ] Old manifest JSON without `constraint` field reads into `ManifestEntry` where `entry.constraint` is `undefined`
- [ ] `ManifestEntry` with `constraint: "^1.0"` round-trips through write/read with the field preserved
- [ ] `ManifestEntry` without `constraint` set serializes to JSON that does not contain the `"constraint"` key
- [ ] `executeNukeAndReinstall` preserves `constraint` from existing entry on reinstall
- [ ] All existing tests pass (`pnpm test`)

**Tests**:
- `"ManifestEntry accepts optional constraint field"` -- construct a ManifestEntry with `constraint: "^1.0"`, verify `entry.constraint` equals `"^1.0"`
- `"ManifestEntry without constraint has undefined constraint"` -- construct a ManifestEntry without constraint field, verify `entry.constraint` is `undefined`
- `"write/read round-trip preserves constraint field"` -- write a manifest with one entry having `constraint: "^1.0"` and another without, read it back, verify the first has `constraint: "^1.0"` and the second has `constraint: undefined`
- `"old manifest without constraint field reads correctly"` -- write raw JSON to disk with no `constraint` key in the entry, read via `readManifest`, verify `entry.constraint` is `undefined` and all other fields are intact
- `"JSON serialization omits undefined constraint"` -- create ManifestEntry without constraint, serialize with `JSON.stringify`, verify the output string does not contain the word `constraint`
- `"JSON serialization includes defined constraint"` -- create ManifestEntry with `constraint: "~1.2"`, serialize with `JSON.stringify`, verify the output string contains `"constraint": "~1.2"`
- `"executeNukeAndReinstall preserves constraint from existing entry"` -- call executeNukeAndReinstall with an existing entry that has `constraint: "^1.0"`, verify the returned entry also has `constraint: "^1.0"`

**Edge Cases**:
- Old manifests without `constraint` field must read correctly — the field is optional so `undefined` is the natural default; no backfill logic is needed (unlike `cloneUrl` which required explicit backfill because it was a required field)
- Constraint field must be absent (not `null`, not empty string) when not constrained — `undefined` in TypeScript, missing key in JSON

**Context**:
> The spec states: "For non-constrained installs, `constraint` is absent. Its absence is the signal — no need for a sentinel value." This means the field must be TypeScript optional (`constraint?: string`), not nullable (`constraint: string | null`). This differs from `ref` and `commit` which use `null` as their sentinel. The spec also states: "No migration needed — `constraint` is purely additive. Old manifest entries without it behave exactly as before."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Manifest Storage" section (Entry Shape, Migration)

## vc-2-2 | pending

### Task vc-2-2: Bare add resolves latest semver tag and auto-applies constraint

**Problem**: Currently, `agntc add owner/repo` (bare add, no `@` suffix) clones the default branch HEAD. The spec requires bare add to resolve the latest stable semver tag, clone at that tag, and auto-apply a `^X.Y.Z` constraint in the manifest. This gives users npm/Composer-style version pinning by default without requiring any version syntax.

**Solution**: In `src/commands/add.ts`, after parsing the source, detect the bare add case (`parsed.constraint === null && parsed.ref === null` and source type is remote). When detected, fetch tags via `ls-remote`, run the tag normalization pipeline (from Phase 1's `src/version-resolve.ts`), and call `resolveLatestVersion()` to find the highest stable semver tag. If found, set `parsed.ref` to the resolved tag name and derive the constraint as `^{cleanedVersion}`. If no semver tags exist, fall back to existing HEAD-tracking behavior (no constraint). The resolved tag name (not the constraint) is passed to `cloneSource` as the `--branch` argument.

**Outcome**: `agntc add owner/repo` on a repo with semver tags installs the latest tag and stores `constraint: "^X.Y.Z"` in the manifest. Repos with no semver tags fall back to HEAD with no constraint. Pre-release-only repos also fall back to HEAD.

**Do**:
- Create a helper function `resolveBarAdd` (or integrate inline) in `src/commands/add.ts` that runs before cloning:
  1. Call `execGit(["ls-remote", "--tags", cloneUrl])` to fetch all tags
  2. Pass the ls-remote output through `normalizeTags()` from `src/version-resolve.ts` (Phase 1)
  3. Call `resolveLatestVersion(normalizedTags)` from `src/version-resolve.ts` — this uses `semver.maxSatisfying(cleanedVersions, '*')` internally
  4. If a tag is found, return `{ ref: tag.original, constraint: "^" + tag.cleaned }` (e.g. `{ ref: "v1.2.3", constraint: "^1.2.3" }`)
  5. If no tag found, return `null` (signals fall back to HEAD)
- In `runAdd()`, after `parseSource()` and before `cloneSource()`, check if bare add applies:
  - Condition: `parsed.type !== "local-path" && parsed.constraint === null && parsed.ref === null`
  - If condition met, call the resolution helper using `resolveCloneUrl(parsed)` as the clone URL
  - If resolution returns a result, mutate `parsed.ref` to the resolved tag name and store the constraint string for later manifest entry construction
  - If resolution returns null, continue with existing HEAD behavior (no changes needed)
- Update the manifest entry construction (step 13 in current `runAdd`) to include `constraint` when it was derived:
  - Constrained: `{ constraint: "^1.2.3", ref: "v1.2.3", commit, ... }`
  - Unconstrained: omit `constraint` field (do not include `constraint: undefined`)
- Ensure `cloneSource(parsed)` receives `parsed.ref` set to the resolved tag name — `git clone --branch v1.2.3` checks out the tag directly
- Update `renderAddSummary` call to pass the constraint for display (or defer display changes to Phase 4)

**Acceptance Criteria**:
- [ ] Bare `add owner/repo` on a repo with tags `v1.0.0`, `v1.1.0`, `v2.0.0` installs at `v2.0.0` with `constraint: "^2.0.0"` in manifest
- [ ] Bare `add owner/repo` on a repo with no semver tags falls back to HEAD with no constraint
- [ ] Bare `add owner/repo` on a repo where all tags are pre-release (e.g. `v2.0.0-beta.1`) falls back to HEAD with no constraint
- [ ] Bare `add owner/repo` on a repo with mixed non-semver tags (e.g. `latest`, `stable`) and semver tags resolves only the semver tags
- [ ] `cloneSource` receives the resolved tag name (e.g. `v1.2.3`) as `parsed.ref`, not the constraint expression
- [ ] Manifest entry for constrained install has `constraint: "^X.Y.Z"`, `ref: "vX.Y.Z"`, and correct `commit`
- [ ] Local paths are not affected — bare `add ./local` still works with no constraint, no tag resolution

**Tests**:
- `"bare add resolves latest semver tag and auto-applies caret constraint"` -- mock ls-remote to return tags v1.0.0, v1.1.0, v2.0.0; verify cloneSource called with ref "v2.0.0" and manifest entry has constraint "^2.0.0"
- `"bare add falls back to HEAD when no semver tags exist"` -- mock ls-remote to return no tags; verify cloneSource called with ref null and manifest entry has no constraint field
- `"bare add falls back to HEAD when only pre-release tags exist"` -- mock ls-remote to return only v2.0.0-beta.1, v3.0.0-alpha.1; verify falls back to HEAD
- `"bare add ignores non-semver tags"` -- mock ls-remote to return "latest", "stable", "v1.0.0"; verify resolves to v1.0.0
- `"bare add with mixed semver and non-semver tags picks highest semver"` -- mock ls-remote to return "release-1", "v1.0.0", "v2.0.0", "nightly"; verify resolves to v2.0.0 with constraint "^2.0.0"
- `"bare add local path skips tag resolution"` -- mock parseSource to return local-path type; verify no ls-remote call made, no constraint applied
- `"bare add stores constraint in manifest entry"` -- verify writeManifest called with entry containing `constraint: "^X.Y.Z"`
- `"bare add clones at resolved tag not constraint expression"` -- verify cloneSource receives `parsed.ref === "v2.0.0"` not `"^2.0.0"`

**Edge Cases**:
- No semver tags exist: fall back to HEAD with no constraint (existing behavior preserved)
- All tags are pre-release: `maxSatisfying(versions, '*')` returns null for pre-release-only sets, so fall back to HEAD
- Repo has only non-semver tags mixed with semver: normalizeTags filters out non-semver tags; if any semver tags remain, resolve from those; if none remain, fall back to HEAD
- ls-remote fails (network error): let the error propagate — the subsequent cloneSource call will also fail with a clear error

**Context**:
> The spec states: "agntc add owner/repo (no @ suffix) will resolve the latest semver tag and auto-apply a ^X.Y.Z constraint. This mirrors npm/Composer behavior." The constraint is derived from the *cleaned* version (no `v` prefix), so `v1.2.3` yields constraint `^1.2.3`. The original tag name (`v1.2.3`) is stored in `ref` because it is the git ref used for checkout. Phase 1 provides `normalizeTags()` and `resolveLatestVersion()` in `src/version-resolve.ts`.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Add Command Behavior > Default Behavior (Bare Add)" and "Add Command Behavior > Latest Tag Resolution (Bare Add)"

## vc-2-3 | pending

### Task vc-2-3: Explicit constraint resolves best matching tag

**Problem**: When a user specifies an explicit constraint like `owner/repo@^1.0` or `owner/repo@~1.2`, the add command must resolve the best matching tag within the constraint bounds, clone at that tag, and store the constraint in the manifest. Currently, the add command treats the `@` suffix as a literal git ref and passes it directly to `git clone --branch`.

**Solution**: In `src/commands/add.ts`, after parsing the source, detect the explicit constraint case (`parsed.constraint !== null`). When detected, fetch tags via `ls-remote`, normalize them, and call `resolveVersion(normalizedTags, parsed.constraint)` from `src/version-resolve.ts` to find the best matching tag. If a match is found, set `parsed.ref` to the resolved tag name for cloning and store `parsed.constraint` in the manifest entry. If no tags satisfy the constraint, report an error and abort.

**Outcome**: `agntc add owner/repo@^1.0` resolves the best tag within `^1.0` bounds, clones at that tag, and stores `constraint: "^1.0"` with the resolved `ref` in the manifest. No-match cases produce a clear error.

**Do**:
- In `runAdd()`, after `parseSource()` and before `cloneSource()`, check if explicit constraint applies:
  - Condition: `parsed.constraint !== null`
  - This is mutually exclusive with the bare-add case (which requires `parsed.constraint === null && parsed.ref === null`)
- When explicit constraint is detected:
  1. Fetch tags via `execGit(["ls-remote", "--tags", resolveCloneUrl(parsed)])`
  2. Normalize tags via `normalizeTags()` from `src/version-resolve.ts`
  3. Call `resolveVersion(normalizedTags, parsed.constraint)` — this uses `semver.maxSatisfying(cleanedVersions, constraint)` internally
  4. If resolved: set `parsed.ref` to the resolved tag name (original form, e.g. `v1.2.3`), store constraint for manifest
  5. If no match: throw an error like `"No tags satisfy constraint ${parsed.constraint}"` — this aborts the add
- Update manifest entry construction to include `constraint: parsed.constraint` when an explicit constraint was used
- Ensure the constraint string stored in manifest is exactly what the user typed (e.g. `^1.0`, not `^1.0.0`) — this preserves user intent

**Acceptance Criteria**:
- [ ] `add owner/repo@^1.0` with tags v1.0.0, v1.1.0, v2.0.0 installs at v1.1.0 with constraint "^1.0"
- [ ] `add owner/repo@~1.0.0` with tags v1.0.0, v1.0.5, v1.1.0 installs at v1.0.5 with constraint "~1.0.0"
- [ ] `add owner/repo@^2.0` with only v1.x tags throws error (no satisfying tags)
- [ ] Manifest entry stores the original constraint expression (e.g. `^1`, not `^1.0.0`)
- [ ] `cloneSource` receives the resolved tag name, not the constraint expression
- [ ] `parsed.ref` is set to the original tag name (e.g. `v1.2.3`) for git checkout

**Tests**:
- `"explicit caret constraint resolves best matching tag"` -- mock ls-remote with v1.0.0, v1.1.0, v2.0.0; add with @^1.0; verify cloneSource called with ref "v1.1.0" and manifest has constraint "^1.0"
- `"explicit tilde constraint resolves best matching tag"` -- mock ls-remote with v1.0.0, v1.0.5, v1.1.0; add with @~1.0.0; verify resolves to v1.0.5 with constraint "~1.0.0"
- `"no tags satisfy constraint throws error"` -- mock ls-remote with v1.0.0, v1.1.0; add with @^2.0; verify error thrown containing "No tags satisfy constraint"
- `"partial constraint resolves against full tags"` -- mock ls-remote with v1.0.0, v1.5.0, v2.0.0; add with @^1; verify resolves to v1.5.0 (^1 === ^1.0.0)
- `"pre-1.0 caret semantics work correctly"` -- mock ls-remote with v0.2.3, v0.2.9, v0.3.0; add with @^0.2.3; verify resolves to v0.2.9 (^0.2.3 means >=0.2.3 <0.3.0)
- `"explicit constraint stores original expression in manifest"` -- add with @^1; verify manifest entry has constraint "^1", not "^1.0.0"
- `"explicit constraint on HTTPS URL works"` -- mock parseSource returning https-url type with constraint "^1.0"; verify same resolution flow
- `"explicit constraint on SSH URL works"` -- mock parseSource returning ssh-url type with constraint "~2.0"; verify same resolution flow

**Edge Cases**:
- No tags satisfy constraint: throw a descriptive error and abort the add (do not fall back to HEAD — the user explicitly asked for a constraint)
- Partial constraint (`^1`) against full tags: `semver.maxSatisfying` handles this natively (`^1` is equivalent to `^1.0.0`)
- Pre-1.0 caret semantics (`^0.2.3`): `semver.maxSatisfying` handles this correctly (minor is breaking boundary for 0.x)
- Empty tag list from ls-remote: same as no-match — throw error

**Context**:
> The spec defines the resolution order: explicit constraint (`@^1`, `@~1.2`) resolves best match. This is distinct from bare add (which derives the constraint automatically) and exact tag (which pins without a constraint). The constraint string stored in the manifest is the user's original input, not a normalized form. Phase 1 provides `resolveVersion(normalizedTags, constraint)` in `src/version-resolve.ts`.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Add Command Behavior > Resolution Order" (items 2-3), "Version Resolution > Resolution Algorithm", "Version Resolution > No Match"

## vc-2-4 | pending

### Task vc-2-4: Exact tag and branch ref preserve existing behavior

**Problem**: When a user specifies an exact tag (`owner/repo@v1.2.3`) or a branch ref (`owner/repo@main`), the existing add behavior must be preserved exactly: clone at the specified ref with no constraint in the manifest. Additionally, re-adding a previously constrained plugin with an exact tag or branch must *remove* the constraint — the new install form completely replaces the old manifest entry.

**Solution**: Ensure the add command's constraint resolution logic (from tasks vc-2-2 and vc-2-3) does not activate for exact tag or branch ref cases. These cases have `parsed.constraint === null` and `parsed.ref !== null`, which makes them pass through the existing code path unchanged. The manifest entry construction must omit the `constraint` field (not set it to `undefined` explicitly), so that re-adding from a constrained install to an exact/branch install naturally removes the constraint from disk.

**Outcome**: Exact tag and branch ref installs produce manifest entries identical to current behavior (no `constraint` field). Re-adding from a constrained state to exact/branch removes the constraint.

**Do**:
- Verify that in `runAdd()`, the constraint resolution code (from vc-2-2 and vc-2-3) has guard conditions that correctly skip when `parsed.ref !== null && parsed.constraint === null`:
  - Bare add guard: `parsed.constraint === null && parsed.ref === null` — exact tags and branches have `ref !== null`, so they skip this
  - Explicit constraint guard: `parsed.constraint !== null` — exact tags and branches have `constraint === null`, so they skip this
- Verify that the manifest entry construction for the non-constrained path does NOT include a `constraint` key at all (not even `constraint: undefined`), ensuring `JSON.stringify` produces output without the field
- The existing nuke-and-reinstall behavior on re-add already handles replacing the manifest entry entirely — the old entry (which may have had `constraint`) is overwritten by the new entry (which lacks `constraint`), effectively removing the constraint
- No new code paths are needed — this task is about verifying the existing + new code interacts correctly and writing tests to prove it

**Acceptance Criteria**:
- [ ] `add owner/repo@v1.2.3` produces manifest entry with `ref: "v1.2.3"`, no `constraint` field
- [ ] `add owner/repo@main` produces manifest entry with `ref: "main"`, no `constraint` field
- [ ] Re-add from constrained (`constraint: "^1.0"`) to exact tag (`@v1.5.0`) produces new entry with `ref: "v1.5.0"`, no `constraint` field
- [ ] Re-add from constrained (`constraint: "^1.0"`) to branch (`@main`) produces new entry with `ref: "main"`, no `constraint` field
- [ ] No ls-remote call is made for exact tag or branch ref adds (no tag resolution needed)
- [ ] `cloneSource` receives `parsed.ref` as-is (e.g. `"v1.2.3"` or `"main"`)

**Tests**:
- `"exact tag add produces manifest entry without constraint"` -- mock parseSource with ref "v1.2.3", constraint null; verify manifest entry has ref "v1.2.3" and no constraint property
- `"branch ref add produces manifest entry without constraint"` -- mock parseSource with ref "main", constraint null; verify manifest entry has ref "main" and no constraint property
- `"exact tag add does not call ls-remote"` -- mock parseSource with ref "v1.2.3", constraint null; verify execGit not called with ls-remote args
- `"branch ref add does not call ls-remote"` -- mock parseSource with ref "main", constraint null; verify execGit not called with ls-remote args
- `"re-add from constrained to exact tag removes constraint"` -- set up existing manifest entry with constraint "^1.0" and ref "v1.1.0"; re-add with @v1.5.0; verify new manifest entry has ref "v1.5.0" and no constraint property
- `"re-add from constrained to branch removes constraint"` -- set up existing manifest entry with constraint "^1.0" and ref "v1.1.0"; re-add with @main; verify new manifest entry has ref "main" and no constraint property
- `"re-add from constrained to bare add applies new constraint"` -- set up existing manifest entry with constraint "^1.0"; re-add bare; verify new manifest entry has a fresh constraint derived from latest tag (this confirms the old constraint is fully replaced, not merged)
- `"cloneSource receives exact tag ref directly"` -- mock parseSource with ref "v1.2.3"; verify cloneSource called with parsed object where ref is "v1.2.3"

**Edge Cases**:
- Re-add from constrained to exact pin must remove constraint: the new manifest entry construction for the non-constrained path simply does not include a `constraint` key, and `addEntry` replaces the entire entry
- Re-add from constrained to branch must remove constraint: same mechanism as exact pin — the new entry overwrites the old one entirely
- Exact tag that looks like semver (e.g. `v1.2.3`) must NOT trigger constraint resolution — the user explicitly typed a specific version, meaning exact pin

**Context**:
> The spec states: "agntc add owner/repo@v1.2.3 means exact pin — no constraint applied. If you typed a specific version, you meant it." It also states re-add behavior: "The existing manifest entry is overwritten via the standard nuke-and-reinstall — the new constraint, ref, and commit values replace the old ones entirely." This means constraint removal on re-add is automatic — it is a consequence of full replacement, not an explicit deletion step.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Add Command Behavior > Explicit Tags Are Exact Pins", "Add Command Behavior > Re-Add Behavior", "Add Command Behavior > Resolution Order" (items 4-5)

## vc-2-5 | pending

### Task vc-2-5: Collection add propagates constraint to each plugin manifest entry

**Problem**: The collection add pipeline in `src/commands/add.ts` (`runCollectionPipeline`) installs multiple plugins from a single source. Each plugin gets its own manifest entry. When the collection is added with a constraint (bare or explicit), that constraint must be propagated to every selected plugin's individual manifest entry. Currently, the collection pipeline writes `ref: parsed.ref` and `commit` to each entry but has no constraint handling.

**Solution**: Apply the same constraint resolution logic from tasks vc-2-2 and vc-2-3 to the collection pipeline. Since all plugins in a collection share the same git repo and the same set of tags, the tag resolution happens once (before the plugin selection/install loop). The resolved constraint and tag are then applied to every selected plugin's manifest entry. For bare collection add, derive `^X.Y.Z` from the latest tag. For explicit constraint, resolve the best matching tag. For exact tag or branch, no constraint.

**Outcome**: `agntc add owner/collection` auto-applies `^X.Y.Z` to all selected plugins. `agntc add owner/collection@^1.0` propagates `^1.0` to all selected plugins. Each plugin has its own independent manifest entry with the constraint, enabling individual update resolution in Phase 3.

**Do**:
- Extract the tag resolution logic (from vc-2-2 and vc-2-3) into a shared helper function that both the standalone and collection pipelines can call. Suggested signature:
  ```typescript
  async function resolveConstraintAndRef(parsed: ParsedSource): Promise<{ ref: string | null; constraint?: string }>
  ```
  This function encapsulates: if bare add, resolve latest tag and derive `^X.Y.Z`; if explicit constraint, resolve best match; if exact/branch, return as-is with no constraint.
- In `runCollectionPipeline()`, call `resolveConstraintAndRef(parsed)` once at the top (after parsing, before plugin selection), getting the resolved `ref` and optional `constraint`
- Update the `parsed.ref` used by `cloneSource` to use the resolved ref (this may require restructuring — currently `cloneSource(parsed)` is called before `runCollectionPipeline`, so the resolution needs to happen before or be passed into the pipeline)
- Actually, looking at the code: `cloneSource(parsed)` happens in `runAdd()` before `runCollectionPipeline` is called. The resolution must happen before cloning. So the shared helper must be called in `runAdd()` before the clone step, and the resolved ref/constraint passed through to both the standalone path and the collection path.
- In `runCollectionPipeline`, update the manifest entry construction (step 6, the loop that builds entries for installed plugins) to include `constraint` when present:
  ```typescript
  const entry = {
    constraint: resolvedConstraint, // from the shared resolution — undefined if not constrained
    ref: resolvedRef,
    commit,
    installedAt: new Date().toISOString(),
    agents: selectedAgents,
    files: result.copiedFiles,
    cloneUrl: deriveCloneUrlForManifest(parsed),
  };
  ```
- The `CollectionPipelineInput` interface may need a `constraint?: string` field to receive the resolved constraint from `runAdd`

**Acceptance Criteria**:
- [ ] Bare `add owner/collection` with tags v1.0.0, v2.0.0 — all selected plugins get `constraint: "^2.0.0"` and `ref: "v2.0.0"` in their manifest entries
- [ ] `add owner/collection@^1.0` with tags v1.0.0, v1.1.0, v2.0.0 — all selected plugins get `constraint: "^1.0"` and `ref: "v1.1.0"`
- [ ] `add owner/collection@v1.0.0` — all selected plugins get `ref: "v1.0.0"` with no constraint
- [ ] `add owner/collection@main` — all selected plugins get `ref: "main"` with no constraint
- [ ] Bare `add owner/collection` with no semver tags — falls back to HEAD, no constraint on any plugin
- [ ] Each plugin's manifest entry is independent — they all share the same constraint/ref/commit but are separate entries in the manifest
- [ ] Tag resolution happens exactly once for the collection, not per-plugin

**Tests**:
- `"collection bare add auto-applies same ^X.Y.Z to all selected plugins"` -- mock ls-remote with v1.0.0, v2.0.0; mock collection with 2 plugins selected; verify both manifest entries have constraint "^2.0.0" and ref "v2.0.0"
- `"collection with explicit constraint propagates to all plugins"` -- mock parseSource with constraint "^1.0"; mock ls-remote with v1.0.0, v1.1.0, v2.0.0; mock 2 plugins selected; verify both entries have constraint "^1.0" and ref "v1.1.0"
- `"collection with exact tag has no constraint on plugins"` -- mock parseSource with ref "v1.0.0", constraint null; mock 2 plugins selected; verify neither entry has constraint property
- `"collection with branch ref has no constraint on plugins"` -- mock parseSource with ref "main", constraint null; mock 2 plugins selected; verify neither entry has constraint property
- `"collection bare add with no semver tags falls back to HEAD"` -- mock ls-remote with no semver tags; verify all plugin entries have ref null, no constraint
- `"collection tag resolution happens once not per-plugin"` -- mock ls-remote; add collection with 3 plugins; verify ls-remote called exactly once (not 3 times)
- `"collection direct-path add preserves existing behavior"` -- mock parseSource returning direct-path type; verify no constraint resolution attempted (direct-path does not support constraints per Phase 1)

**Edge Cases**:
- Collection bare add auto-applies same `^X.Y.Z` to all selected plugins: the resolution runs once on the collection repo's tags, and the result applies uniformly to every selected plugin
- Collection with explicit constraint propagates to all: same single-resolution approach, with the user's constraint string stored in every plugin entry
- Mixed collection where some plugins are skipped (config error, invalid type): skipped plugins do not get manifest entries, but the constraint/ref is still correct for installed plugins
- Collection with no valid plugins after selection: existing error handling applies, constraint resolution has already completed but no entries are written

**Context**:
> The spec states: "agntc add owner/collection@^1.0 — user selects which plugins to install; each selected plugin gets constraint: '^1.0' in its own manifest entry." And for bare: "Bare agntc add owner/collection — auto-applies ^X.Y.Z per default behavior to each selected plugin." The key architectural insight is that tag resolution happens once per collection (since all plugins share the same repo), and the result is propagated to each plugin's independent manifest entry. This enables individual update resolution in Phase 3.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Collection Constraints" section
