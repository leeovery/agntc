TASK: 3.2 — Apply the shared tag-vs-hash rule to the single-key and collapsed all-mode summary renderers (update-output-overhaul-3-2)

ACCEPTANCE CRITERIA:
1. renderGitUpdateSummary renders the move through formatVersionMove: a constrained update (oldRef "v1.2.3", newRef "v1.3.0") prints "Updated <key>: v1.2.3 -> v1.3.0 — …"; file-count/agents tail and dropped-agents suffix unchanged.
2. renderUpdateOutcomeSummary git-update renders "<key>: Updated v1.2.3 -> v1.3.0" for the same refs; local-update branch unchanged.
3. A branch/HEAD update (oldRef === newRef, or newRef null) falls to short hashes on both renderers.
4. A null old commit on the hash path still renders "unknown -> <newShort>" on both renderers.
5. Both renderers call the SAME formatVersionMove from version-resolve.ts (no duplicated decision); identical inputs → identical move substring across single-key and all-mode.
6. Single-key call site passes oldRef: entry.ref / newRef: result.manifestEntry.ref; all-mode collapsed site passes oldRef: entry.ref / newRef: target.tag-or-unchanged-entry.ref.

STATUS: Complete

SPEC CONTEXT: Tag-Based Summary Wording → "Sourcing old/new refs" and "Tags-where-tagged vs hash fallback" (acceptance 3). The rule fires only when both old and new refs are genuine semver tags AND the ref moved; branch/HEAD keeps newRef equal to (or a non-tag/null version of) oldRef → hashes. Both surfaces (single-key renderGitUpdateSummary, all-mode renderUpdateOutcomeSummary) must consume the ONE shared rule authored in task 3-1 (version-resolve.ts) so wording can't drift. This task only consumes it; re-implementing the decision in summary.ts is forbidden.

IMPLEMENTATION:
- Status: Implemented (matches the plan exactly, no drift)
- Location:
  - src/summary.ts:6 imports formatVersionMove from ./version-resolve.js (no cycle — version-resolve.ts imports only "semver"; verified it does not import summary.ts).
  - src/summary.ts:221-244 — GitUpdateSummaryInput extended with oldRef/newRef; renderGitUpdateSummary delegates the move to formatVersionMove and preserves every other token ("Updated ", ": ", " — ", the "N file(s) for <agents>" tail, "sentence"-style droppedSuffix).
  - src/summary.ts:263-298 — git-update arm of UpdateOutcomeInput extended with oldRef/newRef; git-update branch delegates to formatVersionMove and keeps "<key>: Updated …" + "inline" droppedSuffix; local-update branch (296-298) untouched.
  - src/commands/update.ts:289-303 — single-key call site (runSinglePluginUpdate) threads oldRef: entry.ref, newRef: result.manifestEntry.ref, oldCommit: entry.commit, newCommit: result.manifestEntry.commit!. Matches acceptance 6.
  - src/update-groups.ts:208-222 — all-mode git-update summary built in mapReinstallResultToOutcome with oldRef: entry.ref, newRef (= displayRef). reinstallMember (update-groups.ts:317-351) sources displayRef from groupTargetFacets: target.tag for a constrained group, group.versionIntent (branch name / null, == member entry.ref by grouping invariant) for branch/HEAD. Matches acceptance 6's "target.tag-or-unchanged-entry.ref".
- Notes: The all-mode ref-threading was centralized once in mapReinstallResultToOutcome (shared by the collapsed group-of-one AND multi-member paths) rather than duplicated at the group-of-one call site — a behaviourally-invariant plumbing choice that strengthens the "one rule, no divergence" guarantee. No other callers of either renderer exist (grep-verified: renderGitUpdateSummary only at update.ts:289; git-update renderUpdateOutcomeSummary only at update-groups.ts:211). The tag/hash decision is NOT re-implemented anywhere in summary.ts — both renderers call the single formatVersionMove; the " -> " ASCII arrow is emitted by the shared rule.

TESTS:
- Status: Adequate (well-balanced; one minor redundancy, one minor composition gap — both non-blocking)
- Coverage:
  - tests/summary.test.ts:414-447 — renderGitUpdateSummary tags for a constrained update, and tag-move + dropped-agents suffix combo.
  - tests/summary.test.ts:449-481 — branch update (oldRef === newRef) and HEAD update (newRef null) fall to hashes.
  - tests/summary.test.ts:483-495 — null old commit → "unknown -> <newShort>".
  - tests/summary.test.ts:550-609 — renderUpdateOutcomeSummary git-update tags-vs-hashes, and local-update unchanged (explicit byte-exact assertion incl. dropped-agents).
  - tests/summary.test.ts:612-666 — shared-rule cross-surface: single-key and all-mode emit the identical move substring for both the tag path and the hash (branch) path, asserting against formatVersionMove directly.
  - tests/commands/update.test.ts:5436-5471 — single-key runSinglePluginUpdate end-to-end passes entry.ref/result.manifestEntry.ref → "Updated owner/repo: v1.2.3 -> v1.3.0 — 1 file(s) for claude" (acceptance 6, single-key half). Reinforced at 5551-5585.
  - all-mode ref threading (displayRef == target.tag) exercised structurally by the grouped-streaming tests at tests/commands/update.test.ts:1792-1866 (header + divergent member-line tag moves).
- Notes:
  - Mild redundancy: tests/summary.test.ts:386-398 ("uses 'unknown' when old commit is null") and :483-495 ("still renders unknown -> <newShort> …") assert the same behaviour with the same toContain("unknown -> def4567"). The first is pre-existing, the second is task-mandated; they overlap.
  - Composition gap: no all-mode INTEGRATION test asserts a constrained group-of-one collapses to a TAG move ("owner/repo: Updated v1.2.3 -> v1.3.0") via outcome.summary. The collapsed group-of-one tests (update.test.ts:1360-1441) all use head/hash targets; the constrained all-mode tag assertions only cover the multi-member header/member lines. Each half (renderUpdateOutcomeSummary tags at summary.test.ts:550; displayRef==target.tag threading via the grouped tests) is independently proven, so the risk is low.

CODE QUALITY:
- Project conventions: Followed. Single-authored rule in version-resolve.ts (the neutral, cycle-free home), re-exported from update-render.ts; no string-shape branching; ASCII " -> " arrow preserved.
- SOLID principles: Good. Single decision point (formatVersionMove); renderers depend on the shared abstraction rather than duplicating logic.
- DRY: Good. The tag/hash decision lives in exactly one place; both summary renderers and the grouped surface consume it.
- Complexity: Low. Straight delegation; no added branching in the renderers.
- Modern idioms: Yes. Discriminated-union input, template literals, structured field passing.
- Readability: Good. Intent-explaining comments at each threading site (update.ts:291-294, update-groups.ts:158-163, 318-325) name the values and why branch/HEAD lands on hashes.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] tests/summary.test.ts:386,483 — two near-identical null-old-commit tests assert the same `toContain("unknown -> def4567")`; consolidate to one to remove the redundancy.
- [quickfix] tests/commands/update.test.ts (~1441, after the collapsed group-of-one block) — add a single-member constrained all-mode test asserting the collapsed stop-frame renders the tag move ("owner/repo: Updated v1.2.3 -> v1.3.0"), closing the collapsed-path × tag-target composition that current tests cover only in halves.
