---
topic: update-output-overhaul
cycle: 3
total_proposed: 2
---
# Analysis Tasks: Update Output Overhaul (Cycle 3)

## Task 1: Single-source the never-downgrade constrained guard in categorizeMember
status: approved
severity: medium
sources: duplication

**Problem**: The never-downgrade rule for constrained members — "a member already at or above the resolved tag must be treated as up-to-date and never reinstalled" — is a correctness-bearing guard that lives OUTSIDE the single categorization authority. `categorizeMember` (src/update-check.ts:173-204) returns `constrained-update-available` for any constrained member whose stored `ref` is not string-equal to `target.tag`, even when that `ref` is semver-above the tag. Both consumers then re-apply the demotion inline: `runSingleUpdate` at src/commands/update.ts:190-194 and `splitMember` at src/commands/update.ts:558-563 each guard with `if (isAtOrAboveVersion(entry.ref, result.tag)) → return up-to-date`. `splitMember`'s own doc comment points back to "update.ts's `isAtOrAboveVersion`" — i.e. the all-mode build re-authored the single-key guard across the task boundary. Because the categorization verdict is incomplete, every consumer must remember to patch it; nothing enforces that a future third consumer (or a change to the rule) stays in step, and a missed site silently downgrades a member that was already ahead.

**Solution**: Fold the never-downgrade demotion into `categorizeMember`, the pure per-member categorization authority both surfaces already route through (single-key via `checkForUpdate` → `categorizeMember` at src/update-check.ts:128; all-mode via `splitMember` consuming a `categorizeMember` verdict). This makes the verdict correct at its source and lets both call sites drop their inline guard. It does NOT unify the two entry points — they stay separate per the spec's "Rejected: unify all four entry points" decision; only the leaf categorization rule is single-sourced.

**Outcome**: The never-downgrade rule is expressed exactly once, in `categorizeMember`. A constrained member whose stored ref is at or above the resolved tag categorizes as `constrained-up-to-date` at the source. Neither `runSingleUpdate` nor `splitMember` re-derives the demotion, and no future consumer of `categorizeMember` can forget it. Observable behaviour is unchanged: such members still report "already up to date" and are never reinstalled.

**Do**:
1. In `categorizeMember` (src/update-check.ts:173-204), extend the `constrained` arm's up-to-date condition. It currently returns `constrained-up-to-date` only when `target.tag === entry.ref`. Change it so a member also categorizes as `constrained-up-to-date` when `entry.ref` is at or above `target.tag` — i.e. reuse `isAtOrAboveVersion(entry.ref, target.tag)` (import it from src/version-resolve.ts). Preserve the existing `latestOverall: target.latestOverall` payload on the `constrained-up-to-date` result.
2. Remove the now-redundant inline guard from `runSingleUpdate` (src/commands/update.ts:190-194): the `constrained-update-available` branch no longer needs the `if (isAtOrAboveVersion(entry.ref, result.tag))` demotion, because such members now arrive as `constrained-up-to-date` (handled at update.ts:178-181, which already emits the "already up to date" outro). The `constrained-update-available` branch collapses to just the `runSinglePluginUpdate` path.
3. Remove the now-redundant inline guard from `splitMember` (src/commands/update.ts:558-563): the `constrained-update-available` case no longer needs the `if (isAtOrAboveVersion(...)) return upToDateOutcome(key)` demotion; such members now arrive under `constrained-up-to-date` (already handled at update.ts:564-566, returning `upToDateOutcome(key)`). The `constrained-update-available` case reduces to `updating.push(member); return null;`.
4. Update `splitMember`'s doc comment (src/commands/update.ts:541-547) so it no longer describes re-applying the never-downgrade guard against "update.ts's `isAtOrAboveVersion`" — it now inherits a correct verdict from `categorizeMember`.
5. Remove the `isAtOrAboveVersion` import from src/commands/update.ts if it becomes unused after both guards are deleted.

**Acceptance Criteria**:
- The never-downgrade rule appears in exactly one place — `categorizeMember` — with no inline re-application at any call site.
- A constrained member whose stored `ref` is semver-above the resolved `target.tag` categorizes as `constrained-up-to-date` and is never pushed to `updating` / never reinstalled, on both the single-key and all-mode surfaces.
- A constrained member genuinely behind the resolved tag still categorizes as `constrained-update-available` and updates.
- The single-key "already up to date" outro and the all-mode `upToDateOutcome(key)` still fire for at/above constrained members (no user-visible change).
- `npm test` passes.

**Tests**:
- Unit test on `categorizeMember`: given a `constrained` target with `tag` older than a member's stored `ref`, assert it returns `constrained-up-to-date` (not `constrained-update-available`), carrying `latestOverall`.
- Unit test on `categorizeMember`: given a `constrained` target with `tag` newer than a member's stored `ref`, assert it returns `constrained-update-available` and updates.
- Regression test on the single-key `update` path: a constrained plugin already at/above the resolved tag emits "already up to date" and records no reinstall.
- Regression test on the all-mode grouped path (`splitMember`): a constrained member already at/above the resolved tag is demoted to an up-to-date outcome and is not added to the group's `updating` subset (no clone/reinstall).

## Task 2: Compute the divergent-old flag once and thread it to both header and member-line rendering
status: approved
severity: medium
sources: architecture

**Problem**: The spec's version-move placement is a strict XOR: when the updating members of a group share one installed commit, the move rides the group header and member lines stay bare; when their commits diverge, the header shows the target only and every member line carries its own `old -> new`. That single group property — "is this group divergent-old?" — is currently computed independently in two files that must agree. `formatGroupHeader` derives it internally as `new Set(oldCommits).size` with `distinct === 1` gating the shared-header move (src/update-render.ts:152-164), and `streamGroupMemberLines` re-derives the exact complement as `new Set(item.updating.map(m => m.entry.commit)).size > 1` to gate whether each member line gets a `move` (src/commands/update.ts:861). They use identical inputs today so the XOR holds, but the invariant is coincidental, not structural: any future edit to one side's keying (e.g. keying shared-vs-divergent on `ref` instead of `commit`, which the spec discusses) silently breaks the complement, rendering the move twice (header + member line) or dropping it entirely. Both consumers are invoked from the same caller, `streamGroupWork`, which already holds `item.updating`.

**Solution**: Compute the divergent-old flag exactly once in `streamGroupWork` (src/commands/update.ts:690-737) and thread it explicitly to both rendering surfaces — pass it into `streamGroupMemberLines` and into `formatGroupHeader` — so neither re-derives it. "Move renders exactly once" becomes a structural guarantee rather than two set-size computations that must stay in lockstep.

**Outcome**: The divergent-old decision has a single source of truth in `streamGroupWork`. `formatGroupHeader` and `streamGroupMemberLines` consume the same boolean, so the header-move-XOR-member-move invariant cannot drift if the keying ever changes. Rendered output is byte-for-byte identical to today for shared-old and divergent-old groups.

**Do**:
1. In `streamGroupWork` (src/commands/update.ts:690-707), compute the flag once from the data it already holds: `const divergent = new Set(item.updating.map((m) => m.entry.commit)).size > 1;`. Place it before the header is built.
2. Change `formatGroupHeader` (src/update-render.ts:144-165) to accept the divergent flag as an explicit input field instead of deriving `distinct` internally from `oldCommits`. When the flag is false (shared-old), render the shared-header move exactly as today (`formatVersionMove(...)` using `oldRefs[0]`/`oldCommits[0]`); when true (divergent-old), render the target-only header. Keep the existing `count` / `(N members)` suffix. Pass the flag from `streamGroupWork`'s `formatGroupHeader({ ... })` call site.
3. Change `streamGroupMemberLines` (src/commands/update.ts:855-874) to accept the divergent flag as a parameter instead of recomputing `new Set(...).size > 1` at line 861. Use the passed flag to gate each member's `move`. Update the `streamGroupWork` call site (src/commands/update.ts:733) to pass it.
4. Update the doc comments on both `formatGroupHeader` and `streamGroupMemberLines` to state that the divergent-old decision is supplied by the caller (single source), not derived locally.
5. Confirm no other caller of `formatGroupHeader` or `streamGroupMemberLines` exists that would need the new argument; adjust any that do.

**Acceptance Criteria**:
- The divergent-old boolean is computed in exactly one place (`streamGroupWork`); neither `formatGroupHeader` nor `streamGroupMemberLines` derives it from a `Set` size internally.
- A shared-old group (all updating members at one installed commit) renders the move on the header and leaves member lines bare — unchanged from today.
- A divergent-old group (updating members at ≥2 distinct installed commits) renders the target-only header and a per-member `old -> new` move on every member line — unchanged from today.
- The move renders exactly once per member across the header/member-line pair in both cases.
- `npm test` passes.

**Tests**:
- Rendering test: a multi-member group whose updating members share one `entry.commit` produces a header carrying the version move and member lines with no per-member move.
- Rendering test: a multi-member group whose updating members have ≥2 distinct `entry.commit` values produces a target-only header and a per-member move on each member line.
- Guard test (structural): confirm `formatGroupHeader` and `streamGroupMemberLines` both consume the caller-supplied flag — e.g. exercising them with a supplied `divergent` value drives the placement, independent of the `oldCommits` array contents.
