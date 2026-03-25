# Plan: Version Constraints

## Phase 1: Constraint Parsing and Version Resolution
status: approved
approved_at: 2026-03-23

**Goal**: Parse constraint syntax from user input and resolve tags to the best matching version using semver.

**Why this order**: This is the foundational capability. Every subsequent phase — add command, update command, list command — depends on being able to parse `^`/`~` constraint prefixes from the `@` suffix and resolve them against remote tags via semver. Without this, nothing else can be built.

**Acceptance**:
- [ ] Source parser detects `^`/`~` prefixes in the `@` suffix and populates an optional `constraint` field on `ParsedSource` types (`null` for exact/branch/bare/local/tree inputs)
- [ ] Parser validates constraint expressions via `semver.validRange()`, rejecting invalid input (e.g. `@^abc`, `@^`, `@~`, `@^1.2.3.4`) with clear error messages at parse time
- [ ] Constraints are supported on `github-shorthand`, `https-url`, and `ssh-url` source types; rejected on `local-path` and `direct-path`
- [ ] Tag normalization pipeline implemented: collect tags from ls-remote output, clean via `semver.clean()`, discard non-semver tags, prefer `v`-prefixed form when multiple tags clean to the same version
- [ ] Version resolver accepts cleaned tags and a constraint string, returns best match via `semver.maxSatisfying()`, and maps the result back to the original tag name for git checkout
- [ ] No-match case (no tags satisfy constraint) returns null with appropriate context for caller error reporting
- [ ] `semver` added as production dependency and `@types/semver` as dev dependency in `package.json`
- [ ] All existing source-parser tests continue to pass unchanged

### Tasks
status: approved
approved_at: 2026-03-23

| ID | Task | Edge Cases |
|----|------|------------|
| vc-1-1 | Add semver dependency | none |
| vc-1-2 | Extend ParsedSource types with constraint field | existing tests must pass unchanged with constraint: null default |
| vc-1-3 | Detect and extract constraint from source parser | partial versions (^1, ~1.2), constraint on SSH with .git suffix, constraint on HTTPS with .git suffix, empty constraint after operator (^, ~) |
| vc-1-4 | Validate constraint expressions at parse time | invalid semver after operator (^abc, ^1.2.3.4), valid partial versions (^1, ^1.2), tilde variants (~1, ~1.2.3) |
| vc-1-5 | Reject constraints on local-path and direct-path sources | local path with @^ prefix looks like local path not constraint, tree URL with constraint in path portion |
| vc-1-6 | Tag normalization pipeline | duplicate versions (v1.2.3 and 1.2.3 both exist), no semver tags at all, tags with extra whitespace, non-semver tags mixed in (release-candidate, latest) |
| vc-1-7 | Version resolver with constraint matching | no tags satisfy constraint, pre-release tags excluded by maxSatisfying, pre-1.0 caret semantics (^0.2.3), partial constraint (^1) against full tags |

## Phase 2: Add Command with Constraints
status: approved
approved_at: 2026-03-23

**Goal**: Integrate constraint parsing and version resolution into the add command, including the bare-add default behavior that auto-applies `^X.Y.Z`.

**Why this order**: The add command is the entry point for all constraint-based installs. It produces the manifest entries (with the new `constraint` field) that the update and list commands will consume. Phase 1's parsing and resolution logic is required; Phases 3 and 4 consume this phase's output.

**Acceptance**:
- [ ] Bare add (`agntc add owner/repo`) resolves the latest stable semver tag via `maxSatisfying(cleanedVersions, '*')` and auto-applies `^X.Y.Z` constraint; manifest stores both the constraint and the resolved tag
- [ ] Bare add with no semver tags falls back to tracking HEAD with no constraint (existing behavior preserved exactly)
- [ ] Explicit constraint (`owner/repo@^1.0`, `@~1.2`) resolves best matching tag within bounds, stores constraint in manifest, clones at resolved tag
- [ ] Exact tag (`owner/repo@v1.2.3`) installs as exact pin — no constraint field in manifest entry (existing behavior preserved)
- [ ] Branch ref (`owner/repo@main`) tracks branch HEAD with no constraint (existing behavior preserved)
- [ ] `ManifestEntry` type gains optional `constraint` field; field is absent (not null) when not constrained; old manifests without it behave identically (no migration needed)
- [ ] Re-add behavior: overwrites constraint/ref/commit entirely — constraint additions, changes, and removals all work per spec (e.g. `^1.0` to `@v1.5.0` removes constraint)
- [ ] Collection add propagates constraint to each selected plugin's independent manifest entry
- [ ] `git-clone` receives the resolved tag name (not the constraint expression) as the `--branch` argument

### Tasks
status: approved
approved_at: 2026-03-24

| ID | Task | Edge Cases |
|----|------|------------|
| vc-2-1 | Extend ManifestEntry with optional constraint field | old manifests without constraint field read correctly, constraint field absent (not null) when not constrained |
| vc-2-2 | Bare add resolves latest semver tag and auto-applies constraint | no semver tags exist (fall back to HEAD), all tags are pre-release (fall back to HEAD), repo has only non-semver tags mixed with semver |
| vc-2-3 | Explicit constraint resolves best matching tag | no tags satisfy constraint, partial constraint (^1) against full tags, pre-1.0 caret semantics (^0.2.3) |
| vc-2-4 | Exact tag and branch ref preserve existing behavior | re-add from constrained to exact pin must remove constraint, re-add from constrained to branch must remove constraint |
| vc-2-5 | Collection add propagates constraint to each plugin manifest entry | collection bare add auto-applies same ^X.Y.Z to all selected plugins, collection with explicit constraint propagates to all |

## Phase 3: Constrained Update Flow
status: approved
approved_at: 2026-03-23

**Goal**: Implement constraint-aware update resolution so the update command finds newer versions within constraint bounds and reports out-of-constraint availability.

**Why this order**: Update depends on manifest entries containing the `constraint` field (produced by Phase 2's add command) and the version resolution + tag normalization logic (from Phase 1). The update command is the primary consumer of stored constraints.

**Acceptance**:
- [ ] When `constraint` is present in manifest entry: fetch tags via `ls-remote`, run tag normalization pipeline, resolve best match via `maxSatisfying(cleanedVersions, constraint)`, compare against current `ref`
- [ ] Same tag as current = up to date; newer tag = nuke-and-reinstall at new tag (ref and commit updated, constraint stays unchanged); older tag = skip (never downgrade)
- [ ] No satisfying tag = error reported to user, plugin left untouched
- [ ] Out-of-constraint detection implemented: find absolute latest stable tag via `maxSatisfying(cleanedVersions, '*')`, include in output if higher than within-constraint best
- [ ] Constraint-absent entries behave exactly as before — branch tracking, exact tag pinning, and HEAD tracking all unchanged
- [ ] Batch update (`agntc update` with no key) handles mixed constrained and unconstrained plugins correctly
- [ ] Update output UX matches spec: per-plugin results listed first, then collated informational section at end for out-of-constraint versions (section omitted entirely if none exist); info tone, not warning

### Tasks
status: approved
approved_at: 2026-03-24

| ID | Task | Edge Cases |
|----|------|------------|
| vc-3-1 | Constrained update check in update-check | no tags satisfy constraint, current ref tag deleted from remote, all tags are pre-release (no out-of-constraint info), pre-1.0 constraint (^0.2.3), ls-remote failure |
| vc-3-2 | Constraint-absent entries remain unchanged | tag ref without constraint uses old newer-tags logic, branch ref unaffected, HEAD-tracking unaffected, local entry unaffected |
| vc-3-3 | Single-plugin constrained update execution | no-match triggers error without modifying manifest, cloneAndReinstall failure leaves entry untouched, constraint preserved through nuke-reinstall |
| vc-3-4 | Batch update with mixed constrained and unconstrained plugins | all constrained, no constrained (pure backward compat), mix of constrained + branch + tag-pinned + local |
| vc-3-5 | Out-of-constraint info section in update output | no out-of-constraint (section omitted), single plugin with out-of-constraint, multiple plugins, within-constraint best equals absolute latest |

## Phase 4: List Command Integration
status: approved
approved_at: 2026-03-23

**Goal**: Surface constraint information and constraint-aware update status in the list dashboard, and make the change-version action constraint-removing.

**Why this order**: List depends on constraint-aware update checking (Phase 3's logic) and the manifest shape with `constraint` field (Phase 2). It is the final consumer of the constraint system and the least critical to core functionality.

**Acceptance**:
- [ ] List view label shows constraint alongside current ref when present (e.g. `^1.0 → v1.2.3`)
- [ ] Update status in list differentiates between "update available within constraint" and "newer version outside constraint"
- [ ] Change-version action operates outside the constraint system — selecting a specific tag removes the constraint from the manifest entry (equivalent to exact pin re-add per spec)
- [ ] Non-constrained plugins display and behave identically to current behavior (no regressions)

### Tasks
status: approved
approved_at: 2026-03-24

| ID | Task | Edge Cases |
|----|------|------------|
| vc-4-1 | Constrained label formatting in list view | constraint present with null ref (defensive), non-constrained entries display identically |
| vc-4-2 | Constraint-aware status hints in list view | constrained-up-to-date with out-of-constraint info, constrained-no-match shows meaningful hint, non-constrained statuses unchanged |
| vc-4-3 | Constraint-aware detail view actions | constrained-up-to-date with no out-of-constraint (no change-version), constrained-no-match (error info + remove/back only), non-constrained unchanged |
| vc-4-4 | Change-version action removes constraint | entry already has no constraint (no-op), entry with constraint and user selects tag (constraint removed), works with new constrained status types |

## Phase 5: Analysis (Cycle 1)
status: open

**Goal**: Address findings from Analysis (Cycle 1).

### Tasks
status: open

| ID | Task | Edge Cases |
|----|------|------------|
| vc-5-1 | Fix list update action to forward constrained update resolution | constrained-update-available status must include tag and commit fields, non-constrained updates unaffected |
| vc-5-2 | Consolidate ls-remote tag parsing into a single shared function | annotated ^{} refs, empty lines, v-prefixed tags, duplicate versions |
| vc-5-3 | Extract downgrade prevention helper with safe fallback | non-semver refs (branch names), null ref, pre-1.0 versions |
| vc-5-4 | Extract cloneAndReinstall call-object builder in update.ts | local source with sourceDir, overrides present vs absent |
| vc-5-5 | Extract droppedAgents suffix formatter in summary.ts | sentence vs inline style, single vs multiple agents |

## Phase 6: Analysis (Cycle 2)
status: open

**Goal**: Address findings from Analysis (Cycle 2).

### Tasks
status: open

| ID | Task | Edge Cases |
|----|------|------------|
| vc-6-1 | Extract shared test factories to tests/helpers/factories.ts | existing tests must pass unchanged with shared factories, each test file still controls override values via partial-overrides pattern |
| vc-6-2 | Extract shared git mock helpers to tests/helpers/git-mocks.ts | mockExecFile callback normalization must match original behavior, buildTagsOutput format must match ls-remote output exactly |
| vc-6-3 | Add fetchRemoteTagRefs to git-utils.ts to expose full TagRef data | fetchRemoteTags must delegate to fetchRemoteTagRefs, update-check.ts must not call execGit directly for tag fetching |
| vc-6-4 | Show constraint expression in detail view | constraint present displays line, constraint absent omits line, non-constrained entries display identically |

## Phase 7: Review Remediation (Cycle 1)
status: open

**Goal**: Address findings from Review Remediation (Cycle 1).

### Tasks
status: open

| ID | Task | Edge Cases |
|----|------|------------|
| vc-7-1 | Fix formatLabel constraint-with-null-ref edge case | constraint present with null ref returns key + constraint only, constraint present with ref returns full arrow format, non-constrained labels unchanged |
