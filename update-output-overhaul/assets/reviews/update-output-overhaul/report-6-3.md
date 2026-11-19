TASK: 6-3 — Carry structured fields on the updated/refreshed PluginOutcome instead of a pre-rendered summary the renderer discards

ACCEPTANCE CRITERIA (plan Phase 6, task 6-3):
- updated/refreshed outcome carries structured droppedAgents (and optionally agents)
- emitMemberLine composes from structured fields; oldEntry-vs-newEntry set-difference recompute eliminated (droppedAgentsFor removed if unused)
- summary dropped or lazy for members re-rendered by multi-member path
- byte-identical output across collapsed group-of-one, multi-member, local
- dropped-agents notice sourced from structured field
- collapsed/local Refreshed/Updated lines unchanged
- typecheck clean; full suite passes

STATUS: Complete (functional/observable acceptance fully met; one internal sub-criterion consciously not applied — see NON-BLOCKING NOTES)

SPEC CONTEXT:
This is a seam-internal refactor, not a spec-behaviour change. The spec (Per-Unit Progress Output → "Version move & dropped-agents placement") requires the per-member success line to carry `✓ member → agents  (… support removed by author)` sourced per-member, with byte-identical rendering to the pre-existing surface. Task 6-3 changes only *where the dropped-agents set comes from* (the outcome's structured field vs an oldEntry-vs-newEntry recompute) — no observable behaviour changes.

IMPLEMENTATION:
- Status: Implemented (one internal optimization sub-clause deferred)
- Location: src/update-groups.ts:98-121 (PluginOutcome: droppedAgents added to updated/refreshed), :194-222 (mapReinstallResultToOutcome populates droppedAgents on both success arms); src/commands/update.ts:886-914 (emitMemberLine reads outcome.newEntry.agents + outcome.droppedAgents), :837 / :867 (call sites drop the removed `member` param); droppedAgentsFor removed entirely.
- Notes:
  - droppedAgents (and agents via newEntry.agents) are carried on both success variants — criterion 1 met.
  - emitMemberLine composes the success line from structured fields; the oldEntry-vs-newEntry recompute is gone and droppedAgentsFor is removed (grep confirms zero remaining references) — criterion 2 met.
  - Byte-identity is now PROVABLE, not coincidental. The pipeline's dropped set (agent-compat.ts:14 `entryAgents.filter(a => !effective.includes(a))`) uses the same source array and preserves the same order as the old recompute (`oldEntry.agents.filter(a => !newEntry.agents.includes(a))`), and nuke-reinstall-pipeline.ts:301 sets newEntry.agents === effectiveAgents. The old "correctness-by-coincidence the comment had to assert" is eliminated — criterion "dropped-agents notice sourced from structured field" + byte-identical met.
  - The collapsed group-of-one (collapsedMemberLine, update.ts:790-793) and local (streamCollapsedOutcome, update.ts:832-835) success paths still consume outcome.summary verbatim — unchanged.
  - Doc comment on PluginOutcome (update-groups.ts:90-97) is accurate and current (references processLocalUpdate post-6-4 rename).
  - DEVIATION: the plan criterion "summary dropped or lazy for members re-rendered by multi-member path" is NOT met. mapReinstallResultToOutcome still eagerly computes renderUpdateOutcomeSummary(...) at update-groups.ts:198 and :211 for EVERY success outcome, including multi-member members that never display it (emitMemberLine ignores summary). This is exactly the "dead weight … computed, never shown" the task's own problem statement flagged — the task removed the dropped-agents dead weight but left the summary dead weight in place. Zero observable impact. Notably task 8-1 later removed this same "dead presentation residue" from the NON-ACTIONED variants (up-to-date/newer-tags/check-failed/constrained-no-match) but did not touch the success-variant summary, so the finding remains live in the final state.

TESTS:
- Status: Adequate (well-balanced)
- Coverage:
  - Unit (tests/update-groups.test.ts, "mapReinstallResultToOutcome structured dropped-agents"): updated(git) carries droppedAgents=["codex"]; refreshed(local) carries droppedAgents=["codex"]; empty array when nothing dropped. Order-preservation is asserted via the comment + exact toEqual.
  - Integration (tests/commands/update.test.ts): multi-member HEAD group where member `a` drops codex → asserts `"a → claude  (codex support removed by plugin author)"` and member `b` drops nothing → asserts `"b → claude"`. Both hard-coded strings ARE the byte-identity regression assertion, sourced through the multi-member emitMemberLine path (shared old commit → divergent=false → no member-line move, so the line exercises exactly the structured-field composition).
- Notes:
  - Not under-tested: the structured-field carry is locked at the unit level (all three arms incl. the empty case) AND the render-sourcing is locked at integration level with an exact expected string.
  - Not over-tested: no redundant variations; the divergent-old move parenthetical (formatMemberLine, task 2-3) is deliberately not re-tested here — it is unchanged and covered elsewhere.
  - Collapsed group-of-one / local Refreshed/Updated lines are covered by unchanged existing regression tests (baseline green), consistent with the "unchanged" criterion.

CODE QUALITY:
- Project conventions: Followed. Idiomatic discriminated-union extension; success narrowing routed through the shared isSuccessOutcome guard (no casts); AgentId typing correct.
- SOLID principles: Improved. Better separation of concerns — the pipeline owns the dropped-agents computation; the renderer now displays it rather than re-deriving it. Removes a leaky recompute that duplicated pipeline logic in the presentation layer.
- Complexity: Low / reduced — droppedAgentsFor helper deleted; a parameter removed from emitMemberLine and streamCollapsedOutcome.
- Modern idioms: Yes.
- Readability: Good — doc comments clearly explain the structured-field carry and why the recompute was correctness-by-coincidence.
- Issues: The one blemish is the retained eager summary for the multi-member path (below), which leaves a smaller instance of the very dead-weight pattern the task set out to remove.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [idea] src/update-groups.ts:198,211 — Plan criterion "summary dropped or lazy for members re-rendered by multi-member path" is unmet: summary is eagerly computed for every updated/refreshed outcome but discarded for multi-member members (only collapsedMemberLine/streamCollapsedOutcome consume it). Because the shared, path-agnostic constructor (task 6-2) cannot know the render path, eliminating this cleanly needs a thunk (`summary: () => string`, update the two collapsed/local consumers) or moving summary construction to the collapsed call site — a genuine complexity-vs-negligible-savings judgment call the implementer appears to have consciously made against (the PluginOutcome doc comment documents retaining summary). Worth a decision: apply the thunk to honour the criterion, or amend the plan to record that the summary is intentionally retained eagerly. Zero observable impact either way.
