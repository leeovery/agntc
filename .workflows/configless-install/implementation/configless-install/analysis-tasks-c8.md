---
topic: configless-install
cycle: 8
total_proposed: 1
---
# Analysis Tasks: Configless-Install (Cycle 8)

## Task 1: Skills-only default must enumerate inner skills as an installable collection menu
status: pending
severity: high
sources: standards (HIGH); architecture (MEDIUM, related seam — informational)

**Problem**: The feature's headline Vercel-compatible path is broken on the default (flag-free) install. For a root `skills/`-only repo with NO `type` in config and NO `--plugin` flag, the spec (Structural Type Detection → "Skills-only resolution", spec lines 88, 126) mandates resolution to a **collection menu of N independently-installable skills**, mirroring Vercel's `discoverSkills` (walk one level into `skills/`, treat every `skills/<name>/SKILL.md` as a selectable member, install each as a bare skill). The implementation instead returns `{ type: "collection", plugins: [] }` from the skills-only default branch (`src/type-detection.ts:92-96`) — an empty menu. The skills-only branch short-circuits BEFORE `scanCollectionMembers`, and `scanCollectionMembers` only scans the root's child dirs, so the individual skills inside `skills/` are never enumerated. Downstream, `runCollectionPipeline` feeds `selectCollectionPlugins({ plugins: [] })`, which returns `[]` (`src/collection-select.ts:13-15`), and `add.ts:500-503` aborts with `p.cancel("Cancelled — no plugins selected")`. Net effect: the central anchor case of the feature — a bare `skills/`-only third-party repo installed flag-free — produces a zero-member menu and cannot be installed at all on the default path. Only the override paths work. (Orchestrator-verified real; user-confirmed expected behaviour.)

**Solution**: Make the skills-only-default branch enumerate the inner `skills/<name>` units as collection members and route them through the existing collection pipeline so each is offered in the menu and installs as a **bare skill** keyed `owner/repo/<name>`. The two override paths are unchanged: `type: "plugin"` in config bundles the whole `skills/`-only repo as a single plugin, and `--plugin` bundles as a plugin (`--plugin` beats config `type` on disagreement). The only changed behaviour is the flag-free, configless default for a populated `skills/`-only root.

The crux of the pipeline-side work: existing collection members live at `join(sourceDir, pluginName)` and are keyed `${manifestKey}/${pluginName}` (`memberKey`, `src/commands/add.ts:87-94`). Skills-only members instead live one extra level down at `join(sourceDir, "skills", name)`, but their manifest key must still be `owner/repo/<name>` (the skill's own dir basename — NOT `owner/repo/skills/<name>`) and they install as bare skills to `.claude/skills/<name>/` etc. So the member identifier carried through the pipeline must be decoupled: the on-disk member directory and the manifest-key segment can no longer be assumed to be the same single path component for this case.

**Outcome**: Running `add owner/repo` (flag-free, no config `type`) against a repo whose root contains only `skills/` with N populated `skills/<name>/SKILL.md` subdirs presents a multiselect menu of those N skills; the installer can select any subset; each selected skill installs as a bare skill keyed `owner/repo/<name>` and copied to each selected agent's bare-skill location. `type: "plugin"` and `--plugin` continue to bundle the whole repo as one plugin (existing behaviour, byte-for-byte unchanged).

**Do**:
1. **Detection (`src/type-detection.ts`)**: Change the skills-only-default resolution so that, when NOT overridden to plugin (`wantsPlugin === false`), it enumerates the immediate child dirs of the root `skills/` dir that themselves qualify as units (each `skills/<name>` containing `SKILL.md`), instead of returning `{ type: "collection", plugins: [] }`.
   - Reuse the existing one-level structural-membership logic where possible: the qualifying rule for a skills-only inner member is "`skills/<name>/SKILL.md` exists" (a bare-skill member). Prefer factoring the inner scan to reuse `qualifiesAsMember`/`findPresentAssetDirs` semantics so a single membership authority remains.
   - Keep the override branch intact: `wantsPlugin === true` (from `--plugin` or `configType === "plugin"`) still returns `{ type: "plugin", assetDirs: ["skills"] }` for the skills-only root — unchanged.
   - Decide and document how the enumerated members are represented so the pipeline can locate the member dir at `skills/<name>` while keying it `<name>`. Because the public `Collection.plugins: string[]` and the existing pipeline assume member dir = `join(sourceDir, member)` AND key segment = `member`, you must reconcile these. Choose ONE of:
     - (a) Carry members as the path-relative-to-root segment (`skills/<name>`) in `plugins`, and have the pipeline derive the key segment as the basename (`<name>`) while using the full relative path for the member dir; or
     - (b) Introduce a small explicit member descriptor (dir-relative path + key segment) that the skills-only-default and the existing root-child scan both produce, so the pipeline consumes one uniform member shape.
   Whichever you choose, the member dir must resolve to `join(sourceDir, "skills", name)` and the manifest key must be `owner/repo/<name>` (basename), and the existing root-child collection path (`scanCollectionMembers`) must keep working identically.
2. **Collection pipeline (`src/commands/add.ts` `runCollectionPipeline`, ~lines 486-743)**: Update member-dir derivation and keying so they no longer assume `pluginName` is both the single dir component AND the key segment:
   - Member dir: currently `const pluginDir = join(sourceDir, pluginName)` (lines 518, 548). For skills-only members this must resolve to `join(sourceDir, "skills", name)`.
   - Manifest key: `memberKey(parsed, pluginName)` (lines 87-94, 616, 733) must yield `${manifestKey}/<name>` using the basename, not the full relative path.
   - The menu label in `selectCollectionPlugins` (`src/collection-select.ts:17-25`) should display the skill name (basename), and its installed-state key check (`${manifestKeyPrefix}/${name}`) must match the basename key.
   - Per-member detection (lines 560-568) for a skills-only inner member resolves to a bare skill (it has `SKILL.md`, no asset dir at its own root, `memberHasAssetDirs === false`), so it flows through `copyUnit` as `bare-skill` with no override — no change to the `forcePlugin` membership nudge is required for this case.
3. **Do NOT** alter the `--plugin` / `type: plugin` bundle behaviour for the skills-only root, nor the existing root-child member-dirs collection path, nor any other detection branch.

**Acceptance Criteria**:
- `detectType(root, {})` for a root containing only `skills/` with one or more `skills/<name>/SKILL.md` subdirs returns a collection whose members are those inner skill names (one level into `skills/`), NOT an empty `plugins: []`.
- `detectType(root, { configType: "plugin" })` and `detectType(root, { forcePlugin: true })` for the same skills-only root still return `{ type: "plugin", assetDirs: ["skills"] }` (unchanged).
- An empty `skills/` dir (no inner skill subdirs) still resolves to a no-member outcome (no crash; the existing empty-menu/not-actionable behaviour for a genuinely empty `skills/` is acceptable — only the populated case is the defect).
- Installing a populated `skills/`-only repo flag-free presents a selectable menu of the inner skills; each selected member installs as a bare skill keyed `owner/repo/<name>` (basename, not `owner/repo/skills/<name>`) and copied to the bare-skill location for each selected agent.
- The existing root-child member-dirs collection path and all other detection branches are behaviourally unchanged.

**Tests**:
- Update the existing unit test `tests/type-detection.test.ts:149-156` ("defaults skills-only root to collection"): it currently creates an EMPTY `skills/` dir and asserts `{ type: "collection", plugins: [] }`. Re-target it to reflect the new enumeration behaviour — i.e. add a case with a POPULATED `skills/` (e.g. `skills/a/SKILL.md`, `skills/b/SKILL.md`) asserting the members are enumerated (`a`, `b`), and keep/clarify the genuinely-empty-`skills/` case separately.
- Add a unit test asserting the override paths are unchanged for the skills-only root: `{ configType: "plugin" }` and `{ forcePlugin: true }` each return `{ type: "plugin", assetDirs: ["skills"] }`.
- Add an integration test: install a POPULATED `skills/`-only repo flag-free → assert a menu of N skills is offered and that all N are installable as bare skills, each keyed `owner/repo/<name>` and present in the manifest with the correct bare-skill files.
- Add an integration test confirming `--plugin` (and `type: "plugin"`) against the same skills-only repo still bundles the whole repo as a single plugin (existing behaviour preserved).

## Discarded findings (noted, not proposed)

- **duplication LOW** — local-path validation message re-authored across three reinstall sites (`update.ts:207`, `list-update-action.ts:45`, `list-change-version-action.ts:96`). Explicit KNOWN RECURRENCE, below-threshold in c7 and prior. Discarded again.
- **standards LOW #2** — path-traversal guard intentionally skipped on update (`nuke-reinstall-pipeline.ts:92-109`). Self-states "no code change required if the manifest is trusted local state"; confirm-the-decision note, not an actionable defect. Discarded.
- **architecture MEDIUM** — `forcePlugin` overloaded as a membership signal (`add.ts:560-568`). Self-states "no restructuring required for correctness"; coherence-seam observation below the action bar against clean c5/c6. Not force-promoted; discarded. (Noted as a related-seam informational source on Task 1, which touches the same area, but Task 1 does not require changing it.)
- **architecture LOW** — update replay re-implements the `copyUnit` dispatch seam (`nuke-reinstall-pipeline.ts:174-245`). Below-threshold coherence seam. Discarded.
- **architecture LOW** — two type-derivation authorities (`manifestTypeFromDetected` vs `deriveTypeFromFiles`, `manifest.ts:59-63`, `111-129`). Spec-accepted by design; "no restructuring required". Discarded.
