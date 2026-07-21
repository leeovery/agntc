---
topic: update-output-overhaul
cycle: 1
total_proposed: 4
---
# Analysis Tasks: Update Output Overhaul (Cycle 1)

## Task 1: Fix malformed double-`@` re-add command in multi-group newer-tags line
status: pending
severity: high
sources: architecture

**Problem**: `formatNewerTagsLine(label, pinnedRef, newestTag)` (src/update-render.ts:65-71) uses its single `label` argument for TWO semantically distinct purposes — the human line prefix AND the re-add command target — building the command as `npx agntc add ${label}@${newestTag}`. Its caller `emitCollapsedGroupSummary` (src/commands/update.ts:1043-1046) passes `label = groupLabel(group, groups)`, which for a multi-group repo is `@intent`-disambiguated (e.g. `owner/repo@v1.0`). The emitted command then becomes `npx agntc add owner/repo@v1.0@v3.0` — a double-`@`, copy-paste-broken command. The sibling trailing surface `renderOutOfConstraintSection` (src/summary.ts:344-361) handles the identical distinction correctly, rendering the prefix from `label ?? key` but building the command from a separate BARE `repo` field. The multi-group exact-pin newer-tags path also has no end-to-end coverage — the only assertion (tests/update-render.test.ts:366-370) bakes the malformed `owner/repo@main@v2.0` output in as expected, so nothing flags the bug.
**Solution**: Mirror the footer's shape. Give `formatNewerTagsLine` a separate command-target parameter (the bare `repoOf(group)`, as the footer uses `info.repo`) distinct from the `@intent` display label, so the command is `npx agntc add owner/repo@<newest>` regardless of prefix disambiguation.
**Outcome**: The newer-tags trailing line always emits a valid, copy-pasteable `npx agntc add owner/repo@<newestTag>` command with exactly one `@`, in both single-group and multi-group (`@intent`-disambiguated) contexts, while the human-readable prefix retains its disambiguated label.
**Do**:
1. Add a distinct command-target parameter to `formatNewerTagsLine` in src/update-render.ts (e.g. `formatNewerTagsLine(label, commandTarget, pinnedRef, newestTag)`), using `label` only for the human prefix and `commandTarget` for the `npx agntc add ${commandTarget}@${newestTag}` command.
2. Update the caller `emitCollapsedGroupSummary` (src/commands/update.ts:1043-1046) to pass the bare repo (`repoOf(group)`) as the command target alongside the existing `@intent` display label.
3. Correct the baked-in unit test at tests/update-render.test.ts:366-370 to assert the bare command (`owner/repo@<newest>`) rather than the malformed `owner/repo@main@v2.0`.
4. Add a multi-group case asserting that an `@intent`-disambiguated group still produces the bare `npx agntc add owner/repo@<newest>` command.
**Acceptance Criteria**:
- `formatNewerTagsLine` builds its re-add command from a bare repo target and never emits a double-`@`.
- A multi-group exact-pin newer-tags render emits `npx agntc add owner/repo@<newestTag>`.
- The human line prefix still shows the disambiguated `@intent` label.
- Single-group behaviour (where `label === bare repo`) is unchanged.
**Tests**:
- Corrected unit test asserting the bare command with a single `@` (no double-`@`).
- New multi-group test asserting `npx agntc add owner/repo@<newest>` when the display prefix is `@intent`-disambiguated.

## Task 2: Consolidate the triplicated GroupTarget→(ref, commit) projection into one derivation
status: pending
severity: medium
sources: duplication, architecture

**Problem**: The single logical property "what ref/commit does this group land on" is projected from the `GroupTarget` union in three separate places, each re-encoding the same `constrained | branch | head | <unreachable default>` switch with the same "default is unreachable for a streamed group" caveat: `resolveEffectiveTarget` (src/update-groups.ts:204-231) returns the CLONE `{ref, commit}` (constrained→{tag, commit}; branch/head→{undefined, resolvedSha}); `groupTargetCommit` (src/commands/update.ts:810-820) returns the display commit (constrained→commit; branch/head→resolvedSha); `groupTargetRef` (src/commands/update.ts:831-841) returns the display ref (constrained→tag; branch/head→versionIntent). The commit projection is EXACTLY duplicated between `resolveEffectiveTarget.commit` and `groupTargetCommit` (only the unreachable default differs: `""` vs `null`). The display "new ref" is computed twice — once in `groupTargetRef` and once in the member-line move (`reinstallMember` at src/update-groups.ts:251-256 via `effectiveRef ?? entry.ref`) — and coincides today only because a branch group's member `ref` equals its `versionIntent` by construction (a grouping invariant, not a type guarantee). A new streamed `GroupTarget` arm requires all three sites edited in lockstep.
**Solution**: Co-locate the derivation in one place beside `GroupTarget` (in src/update-groups.ts, or update-check.ts where `GroupTarget` lives). Either extend `resolveEffectiveTarget` to also expose the display ref and commit, or add a single `groupTargetFacets(target, group)` returning `{ commit, cloneRef, displayRef }`. Have `groupTargetCommit`/`groupTargetRef` and the member-line move read from that one derivation instead of re-switching. Preserve the genuine branch/head distinction between the clone ref (`undefined`) and the display ref (`versionIntent`).
**Outcome**: One switch over `GroupTarget.kind` owns the group's commit, clone ref, and display ref; the header "new", the member-line "new", and the collapsed group-of-one "new" all read the same projection, so they cannot drift and a new streamed arm is a single-site change.
**Do**:
1. Define a single derivation co-located with `GroupTarget` returning `{ commit, cloneRef, displayRef }` (or extend `resolveEffectiveTarget` to expose `displayRef` and the display commit), encoding the `constrained | branch | head` arms and the unreachable-default caveat exactly once.
2. Rewrite `groupTargetCommit` (src/commands/update.ts:810-820) to read `commit` from that derivation instead of re-switching.
3. Rewrite `groupTargetRef` (src/commands/update.ts:831-841) to read `displayRef` from that derivation.
4. Route the member-line move (`reinstallMember`, src/update-groups.ts:251-256) and the collapsed group-of-one line through the same `displayRef`, so header/member/collapsed moves share one value.
5. Keep the branch/head clone-ref override (`undefined`, for `--branch`) distinct from the display ref (`versionIntent`).
**Acceptance Criteria**:
- Exactly one switch over `GroupTarget.kind` derives the group's commit and refs; all other sites read from it.
- The clone `--branch` override (branch/head→undefined) and the display ref (branch/head→versionIntent) remain distinct and correct.
- Header "new", member-line "new", and collapsed group-of-one "new" all originate from the single projection.
- Adding a hypothetical new streamed `GroupTarget` arm requires editing only the one derivation.
**Tests**:
- Existing update-groups / update tests pass unchanged (behaviour-preserving refactor).
- Assertions across constrained, branch, and head groups verifying header, member-line, and collapsed refs and commit agree with the single derivation.

## Task 3: Extract shared outcome→member-line failure/skip rendering
status: pending
severity: medium
sources: duplication

**Problem**: `collapsedMemberLine` (group-of-one stop-frame, src/commands/update.ts:756-784) and `emitMemberLine` (multi-member stream, src/commands/update.ts:901-953) both switch over the same `PluginOutcome` statuses and build the loud/skip lines via `formatMemberLine`. The `copy-failed` / `aborted` / `blocked` / `skipped-no-agents` arms are identical modulo the name source (`outcome.key` vs the passed basename) — same `kind`, same `recoveryHint`/`message = outcome.summary`, same no-agents shape — and the default bare-`failed` arm also mirrors. Only the success arm genuinely differs (collapsed reuses `outcome.summary`; streamed builds a full success line with agents + divergent-old move). This is copy-paste drift across two task boundaries: a new failure variant must be added to both switches or the two render paths silently diverge.
**Solution**: Extract one `failureOrSkipMemberLine(outcome, name): MemberLine` covering the four loud/skip arms plus the bare-`failed` fallback, parameterising the name source, and call it from both `collapsedMemberLine` and `emitMemberLine`, each retaining only its own success handling.
**Outcome**: The four loud/skip arms and the bare-`failed` fallback exist in exactly one place; both render paths delegate to it and keep only their divergent success rendering, so a new failure status is a single-site change and the collapsed and streamed paths cannot diverge on failures/skips.
**Do**:
1. Extract `failureOrSkipMemberLine(outcome, name): MemberLine` in src/commands/update.ts covering `copy-failed`, `aborted`, `blocked`, `skipped-no-agents`, and the bare-`failed` default, taking the display name as a parameter (so `outcome.key` vs basename is supplied by the caller).
2. Replace those arms in `collapsedMemberLine` (src/commands/update.ts:756-784) with a call to the shared helper, keeping its collapsed success handling (`outcome.summary`).
3. Replace those arms in `emitMemberLine` (src/commands/update.ts:901-953) with a call to the shared helper, keeping its streamed success line (agents + divergent-old move).
**Acceptance Criteria**:
- The four loud/skip arms and the bare-`failed` fallback are defined once; both `collapsedMemberLine` and `emitMemberLine` delegate to the shared helper.
- Each caller retains only its own success-arm rendering.
- Adding a new failure status changes exactly one switch.
- Rendered output is byte-identical for every failure/skip status across both the collapsed and streamed paths.
**Tests**:
- Existing member-line rendering tests pass unchanged.
- Coverage asserting the collapsed and streamed paths produce identical lines for each of `copy-failed`, `aborted`, `blocked`, `skipped-no-agents`, and bare-`failed`.

## Task 4: Extract shared helpers for scattered newest-tag and key→repo/basename idioms
status: pending
severity: low
sources: duplication

**Problem**: Two small inline idioms are re-authored across the update-output code and drift when only one site is updated. (a) The "newest of an ascending newer-tags list" idiom `[...tags].reverse()[0]!` appears three times — single-key newer-tags (src/commands/update.ts:164), `splitMember` newer-tags (src/commands/update.ts:576), and `emitCollapsedGroupSummary` (src/commands/update.ts:1044) — each feeding an `agntc add …@<newest>` command or notice; the "why reverse" (lists are oldest-first) is non-obvious and re-encoded at each site. (b) The "bare owner/repo from a key" transform `key.split("/").slice(0,2).join("/")` is authored twice — inline in `extractOutOfConstraint` (src/commands/update.ts:135) and as the exported `repoOf(group)` (src/update-render.ts:17-19) — because one works on a raw key and the other on a group; and member-basename extraction `key.split("/").pop()!` is inlined twice (src/commands/update.ts:735 clone-failure affected list, :886 member-line name). These key-shape and tag-ordering manipulations drift apart when only one site changes.
**Solution**: Add tiny named helpers that document the assumptions in one place and route every site through them: `newestTag(tags)` beside the tag utilities in src/version-resolve.ts (documenting the ascending/oldest-first assumption); `repoFromKey(key)` and `memberName(key)` in a shared module (src/source-parser.ts or src/update-render.ts). `repoOf(group)` becomes `repoFromKey(group.members[0].key)`.
**Outcome**: The tag-ordering and key-shape assumptions each live in one documented helper; all listed call sites share them, so a future change to tag ordering or key shape is a single-site edit with no silent drift.
**Do**:
1. Add `newestTag(tags)` in src/version-resolve.ts documenting the ascending-order (oldest-first) assumption; route src/commands/update.ts:164, :576, and :1044 through it.
2. Add `repoFromKey(key)` and `memberName(key)` in a shared module (src/source-parser.ts or src/update-render.ts); route `extractOutOfConstraint` (src/commands/update.ts:135) and the member-basename sites (:735, :886) through them, and change `repoOf(group)` (src/update-render.ts:17-19) to `repoFromKey(group.members[0].key)`.
**Acceptance Criteria**:
- `newestTag`, `repoFromKey`, and `memberName` are each defined once and called from every listed site.
- No remaining inline `[...tags].reverse()[0]`, `.slice(0,2).join("/")`, or key-basename `.pop()` at the listed sites.
- Behaviour is unchanged at every call site.
**Tests**:
- Unit tests for `newestTag` (ascending input → newest tag), `repoFromKey` (strips the `/<member>` suffix), and `memberName`.
- Existing tests exercising the affected call sites pass unchanged.
