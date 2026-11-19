AGENT: duplication
FINDINGS:
- FINDING: GroupTarget→(ref, commit) derivation forked across three functions
  SEVERITY: medium
  FILES: src/update-groups.ts:221-231, src/commands/update.ts:810-820, src/commands/update.ts:831-841
  DESCRIPTION: Three functions independently switch on `GroupTarget.kind` with the
    identical `constrained` / `branch`|`head` / `default` arm structure to derive a
    group's effective ref and commit. `resolveEffectiveTarget` (update-groups.ts)
    returns `{ref, commit}` for the CLONE (constrained→{tag, commit}; branch/head→
    {undefined, resolvedSha}). `groupTargetCommit` (update.ts) returns the same commit
    (constrained→commit; branch/head→resolvedSha) and `groupTargetRef` (update.ts)
    returns the DISPLAY ref (constrained→tag; branch/head→versionIntent). All three
    encode the same invariant ("only constrained/branch/head groups ever stream; the
    rest are unreachable") and all three re-derive the same target commit. They must
    stay in sync — a new `GroupTarget` arm that carried updating members would need
    all three edited, and the commit derivation is verbatim between two of them (only
    the unreachable default differs: `""` vs `null`). The branch/head ref split
    (display `versionIntent` vs clone `undefined`) is a genuine distinction, but the
    commit and the constrained-ref (`target.tag`) are duplicated.
  RECOMMENDATION: Co-locate the derivation in one place beside `GroupTarget` (e.g.
    extend `resolveEffectiveTarget` in update-groups.ts to also expose the display ref,
    or add a single `groupTargetFacets(target, group)` returning `{commit, cloneRef,
    displayRef}`). Have `groupTargetCommit`/`groupTargetRef` read from that one
    derivation instead of re-switching, so a new streamed `GroupTarget` kind is a
    single-site change.

- FINDING: PluginOutcome→member-line dispatch duplicated in collapsedMemberLine and emitMemberLine
  SEVERITY: medium
  FILES: src/commands/update.ts:756-784, src/commands/update.ts:901-953
  DESCRIPTION: `collapsedMemberLine` (group-of-one stop-frame, task 2-2) and
    `emitMemberLine` (multi-member stream, task 2-3) both switch over the same
    `PluginOutcome` statuses and build the loud/skip lines via `formatMemberLine`. The
    `copy-failed` / `aborted` / `blocked` / `skipped-no-agents` arms are identical
    modulo the name source (`outcome.key` vs the passed basename) — same `kind`, same
    `recoveryHint`/`message` = `outcome.summary`, same `no-agents` shape. The default
    (bare `failed`) arm also mirrors. Only the success arm genuinely differs
    (collapsed reuses `outcome.summary`; streamed builds a full success line with
    agents + divergent-old move). This is copy-paste drift across two task boundaries:
    a new failure variant must be added to both switches or the two rendering paths
    silently diverge. (`renderOutcomeSummary` at update.ts:1058-1079 is a third,
    broader status→log-level switch in the same file, overlapping the default arms.)
  RECOMMENDATION: Extract one `failureOrSkipMemberLine(outcome, name): MemberLine`
    covering the four loud/skip arms + the bare-`failed` fallback, and call it from
    both `collapsedMemberLine` and `emitMemberLine`, each retaining only its own
    success handling. A new failure status then changes one switch.

- FINDING: "newest of a newer-tags list" recomputed inline three times
  SEVERITY: low
  FILES: src/commands/update.ts:164, src/commands/update.ts:576, src/commands/update.ts:1044
  DESCRIPTION: The `[...tags].reverse()[0]!` idiom — take the newest of an
    ascending-ordered newer-tags list — appears three times (single-key newer-tags at
    :164, `splitMember` newer-tags at :576, `emitCollapsedGroupSummary` at :1044), each
    feeding an `agntc add …@<newest>` command or notice. Small (one-liners), but the
    "why reverse" (lists are oldest-first) is non-obvious and re-encoded at each site;
    if the tag ordering ever changed, all three would need updating in lockstep.
  RECOMMENDATION: A tiny named helper (e.g. `newestTag(tags)` beside the tag utilities
    in version-resolve.ts) documents the ascending-order assumption in one place and
    lets the three sites share it. Low priority given the one-line footprint.

- FINDING: bare-repo / basename key parsing scattered; existing repoOf not reused
  SEVERITY: low
  FILES: src/commands/update.ts:135, src/update-render.ts:17-19, src/commands/update.ts:735, src/commands/update.ts:886
  DESCRIPTION: The "bare owner/repo from a key" transform `key.split("/").slice(0,2)
    .join("/")` is authored twice — inline in `extractOutOfConstraint` (update.ts:135)
    and as the exported `repoOf(group)` (update-render.ts:17-19) — with matching intent
    comments about stripping the `/<member>` suffix; `extractOutOfConstraint` does not
    reuse the existing helper because it works on a raw key rather than a group.
    Separately, member-basename extraction `key.split("/").pop()!` is inlined twice
    (update.ts:735 clone-failure affected list, :886 member-line name). These key-shape
    manipulations drift apart when only one site is updated.
  RECOMMENDATION: Add a `repoFromKey(key)` (and a `memberName(key)`) helper in a shared
    module (e.g. source-parser.ts or update-render.ts) and route all four sites through
    them — `repoOf(group)` becomes `repoFromKey(group.members[0].key)`, and
    `extractOutOfConstraint`/`groupOutOfConstraintInfo` share the same repo derivation.
SUMMARY: Two medium consolidation candidates in the new group-streaming code —
  triplicated `GroupTarget`→ref/commit derivation and a duplicated outcome→member-line
  switch across the collapsed and multi-member render paths — plus two low-severity
  scattered one-liners (newest-tag extraction and key→repo/basename parsing).
