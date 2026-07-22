AGENT: architecture
FINDINGS:
- FINDING: "Divergent-old" is decided independently on both sides of the header/member-line seam
  SEVERITY: medium
  FILES: src/update-render.ts:152-165, src/commands/update.ts:855-874, src/commands/update.ts:698-734
  DESCRIPTION: The spec's placement rule for a group's version move is a strict XOR: when
    the updating members share one installed commit the move rides the group *header* and
    member lines stay bare; when their commits diverge the header shows the target only and
    *every* member line carries its own `old -> new`. That single group property ("is this
    group divergent-old?") is currently computed in two different files that must agree.
    `formatGroupHeader` derives it internally as `new Set(oldCommits).size` (update-render.ts:153,
    `distinct === 1` → shared header move), and `streamGroupMemberLines` re-derives the exact
    complement as `new Set(item.updating.map(m => m.entry.commit)).size > 1` (update.ts:861,
    gating whether each member line gets a `move`). They happen to use identical inputs today,
    so the XOR holds — but the invariant is coincidental, not structural. Any future edit to one
    side's keying (e.g. keying shared-vs-divergent on `ref` instead of `commit`, which the spec
    discusses) silently breaks the complement, producing the move rendered *twice* (header +
    member line) or *dropped* entirely. This is the "derive, don't independently compute" seam
    smell: two logical inverses authored separately across a module boundary, correctness
    depending on them never drifting.
  RECOMMENDATION: Compute the divergent-old flag once in `streamGroupWork` (it already holds
    `item.updating`) and thread it explicitly to both surfaces — pass it into
    `streamGroupMemberLines` and have `formatGroupHeader` accept it (or return whether it
    consumed the shared old) rather than re-deriving. That makes "move renders exactly once" a
    structural guarantee instead of two set-size computations that must stay in lockstep.

- FINDING: OutOfConstraintInfo carries a dual-optional identity plus a dead field
  SEVERITY: low
  FILES: src/summary.ts:310-342, src/summary.ts:344-361, src/commands/update.ts:134-142, src/commands/update.ts:528-538
  DESCRIPTION: `OutOfConstraintInfo` is a cross-layer boundary type built by BOTH the single-key
    path (`extractOutOfConstraint`, sets `key`) and the all-mode per-group path
    (`groupOutOfConstraintInfo`, sets `label`), then rendered via `info.label ?? info.key`
    (summary.ts:357). Modeling one identity as two mutually-exclusive optionals resolved by a
    fallback puts correctness on caller discipline: a caller that populated neither (or a future
    third caller) renders a literal `undefined` with no type-level guard. Separately, the
    `constraint` field is dead — its own comment says "no longer rendered," and a grep confirms
    no renderer reads `info.constraint`; both call sites still compute and thread it
    (`entry.constraint`, `group.versionIntent!`).
  RECOMMENDATION: Collapse `key?`/`label?` to a single required `label: string` computed at each
    call site (single-key passes the bare `key`, all-mode passes `groupLabel(...)`), removing the
    `label ?? key` fallback. Drop the unused `constraint` field and its two assignments.

- FINDING: groupTargetFacets default arm returns an empty-string commit sentinel instead of failing loud
  SEVERITY: low
  FILES: src/update-groups.ts:276-297
  DESCRIPTION: `groupTargetFacets` owns the single projection of a resolved `GroupTarget` into the
    `{ commit, cloneRef, displayRef }` that drives the clone ref, header "new", member-line "new",
    and collapsed "new". Only `constrained`/`branch`/`head` targets ever reach a streamed group;
    the remaining kinds fall through to a `default` arm returning `{ commit: "", cloneRef: undefined,
    displayRef: null }`. That empty-string commit is a value that would be silently *wrong* if ever
    reached — it would clone at / record an empty commit rather than surfacing the mistake. The arm
    is unreachable only by construction (callers pre-filter to updatable groups); a future streamed
    `GroupTarget` variant added without a matching arm would corrupt silently instead of erroring.
  RECOMMENDATION: Make the invariant self-enforcing: `throw` in the default arm (e.g.
    "groupTargetFacets called on a non-streamed target kind") so a missing arm fails loud at the
    seam rather than producing an empty-commit clone/record.
SUMMARY: Module boundaries (grouping in update-groups, rendering in update-render, resolution in
  update-check, wiring in update.ts) are clean and the outcome/failure model is well single-sourced.
  One medium seam issue stands out: the divergent-old version-move placement is decided by two
  independent set-size computations across the header/member-line boundary that must stay exact
  complements; plus two low type-hygiene fragilities (a dual-optional + dead field on
  OutOfConstraintInfo, and a silent empty-commit default in groupTargetFacets).
