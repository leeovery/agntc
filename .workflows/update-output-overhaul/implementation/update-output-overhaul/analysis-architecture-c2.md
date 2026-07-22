AGENT: architecture
FINDINGS:
- FINDING: `processUpdateForAll` is a stale general-purpose function now serving only local entries
  SEVERITY: medium
  FILES: src/commands/update.ts:312-343, src/commands/update.ts:830-841
  DESCRIPTION: After the group-first pivot, every git entry flows through
    `streamGroupWork` → `processGroupUpdate`. The only remaining caller of
    `processUpdateForAll` is `streamLocalWork` (line 835), which passes a local
    entry and no overrides. That leaves the function structurally mis-scoped for
    its one real use: (a) its `overrides?: VersionOverrides` param is dead — the
    sole caller never passes it, so the `...overrides` spread on line 320 is
    always `{}`; (b) the git-update arm inside `mapReinstallResultToOutcome`
    (update-groups.ts:173-186) is now unreachable from this path, since a local
    entry (`commit === null`) always takes the `refreshed` arm; (c) the code has
    to launder that dead generality with a documented benign-lie comment
    (lines 331-335) explaining that it passes `entry.ref` as `newRef` purely
    because "the git-update arm's newRef is never consulted here." A function
    whose signature and body advertise more than the one narrow case it serves,
    kept honest only by an apologetic comment, is a seam that will mislead the
    next editor and invites a real bug if someone reroutes a git entry back
    through it.
  RECOMMENDATION: Narrow it to what it does — rename to `processLocalUpdate`,
    drop the `overrides` param, and drop the `newRef` threading (call the local
    branch directly, or keep `mapReinstallResultToOutcome` but pass no ref). The
    git generality lives — correctly — only in `processGroupUpdate` now.

- FINDING: `PluginOutcome` carries a pre-rendered `summary` string but not the structured data its richest consumer needs, forcing a recompute
  SEVERITY: medium
  FILES: src/update-groups.ts:90-106, src/update-groups.ts:173-186, src/commands/update.ts:903-946
  DESCRIPTION: The updated/refreshed `PluginOutcome` is built with a fully
    pre-rendered `summary` (via `renderUpdateOutcomeSummary`), but the
    multi-member streamed renderer (`emitMemberLine`) ignores that string and
    re-renders the line from scratch via `formatMemberLine`, needing
    `newEntry.agents` and the *structured* dropped-agents set. Because the
    outcome does not carry dropped agents structurally, `droppedAgentsFor`
    (update.ts:941-946) reconstructs them by set-differencing `oldEntry.agents`
    against `newEntry.agents` — data the pipeline already computed
    (`result.droppedAgents`) and then discarded into the summary string. So the
    boundary type between the orchestrator and the renderer is stringly-typed
    where structured fields are what's actually consumed: the pre-rendered
    `summary` is dead weight for every multi-member member (computed, never
    shown), and the structured droppedAgents has to be re-derived. This is the
    "untyped/pre-rendered container across a layer boundary" smell — it works
    only because the recompute is provably equal, a correctness-by-coincidence
    the comment itself has to assert.
  RECOMMENDATION: Carry the structured fields on the updated/refreshed outcome
    (e.g. `agents` and `droppedAgents`, which the pipeline already returns) and
    have all render paths compose from them; drop or lazily-derive the `summary`
    string so it is produced only where actually displayed (the collapsed
    group-of-one / local paths). Removes both the wasted render and the
    set-difference recompute, and makes the seam self-contained.

- FINDING: The subpath-containment guard + reinstall-from-clone body is authored twice across the singleton/grouped seam
  SEVERITY: medium
  FILES: src/clone-reinstall.ts:389-419, src/update-groups.ts:289-322
  DESCRIPTION: `cloneAndReinstall`'s remote branch and `reinstallMember` both
    implement the identical inner unit: run the per-member `sourceSubpath`
    lexical containment guard (`assertSubpathWithinClone`, mapping a
    `PathTraversalError` to a clone-failed result), then
    `resolveUpdateSourceDir`, then `runPipeline` with `cloneRoot = tempDir`. The
    spec deliberately kept `cloneAndReinstall` intact for the singletons and
    added the group orchestrator — but that decision was about the *clone
    lifecycle*, not this inner body. The sharing correctly stopped at
    `runPipeline` (the clone-agnostic reinstall half) and then re-diverged one
    level up, leaving the containment guard — which the spec explicitly calls a
    "preservation constraint, not a design choice" (a path-traversal security
    invariant) — living in two independent copies. The two paths currently apply
    it identically, but nothing structurally binds them: a future tweak to one
    guard (or its error mapping) silently leaves the other path unguarded. A
    security invariant duplicated across a seam is a latent regression, not a
    style nit.
  RECOMMENDATION: Extract the shared unit — e.g.
    `reinstallFromClone(tempDir, key, entry, {newRef, newCommit, projectDir}):
    CloneReinstallResult` owning the guard + `resolveUpdateSourceDir` +
    `runPipeline` — and have both `cloneAndReinstall` (after its single clone)
    and `reinstallMember` compose it, each mapping the returned
    `CloneReinstallResult` to its own outcome shape. Single-sources the guard so
    the two paths cannot drift.

- FINDING: `groupTargetFacets` returns a structurally-invalid facet for non-streamed target kinds instead of an explicit unreachable
  SEVERITY: low
  FILES: src/update-groups.ts:240-261, src/commands/update.ts:698-748
  DESCRIPTION: The `default` arm returns `{ commit: "", cloneRef: undefined,
    displayRef: null }` for the `tag` / `constrained-no-match` / `check-failed`
    kinds. Its correctness rests entirely on the upstream invariant that only
    `constrained`/`branch`/`head` groups ever acquire updating members and thus
    reach `streamGroupWork` → `groupTargetFacets`. That invariant holds today
    (categorizeGroups only populates `updating` for update-available kinds), but
    the fallback returns a fabricated empty commit rather than making the
    impossibility explicit — so if a future categorization change ever routes a
    non-updating target into a streamed group, the failure is silent: an empty
    string is threaded as `newCommit` into the header and, via `runPipeline`,
    persisted to the manifest. Correctness depends on caller discipline where a
    self-contained contract could enforce it.
  RECOMMENDATION: Make the non-streamed arms explicit — `throw` an "unreachable:
    non-updating target reached streamed group" error (or use an exhaustiveness
    `never` check), so a routing regression surfaces loudly instead of writing a
    blank commit.

- FINDING: `OutOfConstraintInfo` retains a dead `constraint` field on a cross-layer boundary type
  SEVERITY: low
  FILES: src/summary.ts:310-342, src/summary.ts:344-361, src/commands/update.ts:132-140
  DESCRIPTION: The actionable rewrite dropped the constraint from the rendered
    footer wording (`renderOutOfConstraintSection` no longer reads it), yet every
    producer still populates `constraint` and the field is documented as
    "Retained for the call sites, no longer rendered." Dead data on a shared
    boundary type is a small but real cleanliness cost: it implies a contract the
    renderer no longer honours, and the paired `key?`/`label?` optionality
    (rendered as `label ?? key`) already forces readers to track which producer
    sets which. Not load-bearing, but it muddies an otherwise clean seam.
  RECOMMENDATION: Drop `constraint` from `OutOfConstraintInfo` and its
    producers. Optionally collapse `key?`/`label?` into a single required
    `label` (single-key can pass its key as the label) so the type has one
    unconditional identity field.
SUMMARY: The group-first engine and two-granularity output surface compose well overall — `runPipeline`/`categorizeMember`/`formatVersionMove` are cleanly single-sourced and the grouped path reuses them correctly. The notable issues are a few seams left one step short of clean: a now-local-only function retaining dead git generality, an outcome boundary type that pre-renders a string while forcing its consumer to recompute structured data, and a security-relevant containment guard duplicated across the singleton/grouped seam.
