TASK: 2.2 — Format the group header: label, member count, shared-vs-divergent version move (update-output-overhaul-2-2)

ACCEPTANCE CRITERIA:
1. Shared-old group (all oldCommits equal) → `Updating <label>  <oldShort> -> <newShort>  (N members)`.
2. Divergent-old group (oldCommits ≥2 distinct) → `Updating <label> -> <newShort>  (N members)`, no old ref on header.
3. `(N members)` equals oldCommits.length — attempted-member count; only updating members (up-to-date siblings excluded by caller).
4. Version move renders as 7-char short commit hashes (INTERIM), never semver tags — no tag-vs-hash branching in formatGroupHeader/formatVersionMove.
5. formatVersionMove(a,b) is the single move renderer reused verbatim by the divergent-old member line (Task 2.3).

STATUS: Complete

SPEC CONTEXT:
Spec *Per-Unit Progress Output → Version move & dropped-agents placement* ("Header 'old' ref when updating members diverge") and *Partial collections & counts → Header count/noun is generic*, plus acceptance 2. The new ref is a shared group property (resolved target); the old ref is per-member. When updating members share one installed commit, the header carries the shared `old → new`; when they diverge, the header shows the target only and each member line carries its own move. `(N members)` counts the attempted (updating) set, fixed at spinner start; up-to-date siblings are excluded. The task explicitly flags an INTERIM constraint: formatVersionMove is hash-based here, and Phase 3 (*Tag-Based Summary Wording*) rewords this one helper (and callers) to speak in tags where both refs are genuine semver tags AND the ref moved.

IMPLEMENTATION:
- Status: Implemented (correct in the final, Phase-3-completed state)
- Location:
  - src/update-render.ts:148-169 (formatGroupHeader)
  - src/version-resolve.ts:53-63 (formatVersionMove — moved to the cycle-free tag-vs-hash home) + src/update-render.ts:10 (re-export so callers/tests still import from update-render)
  - src/commands/update.ts:671-726 (streamGroupWork — the caller computing `divergent` and threading label/oldCommits/oldRefs/newCommit/newRef)
- Notes on the acceptance criteria in the FINAL state:
  - AC1 (shared-old header): met — divergent=false branch returns `Updating ${label}  ${move}  (${count} members)` (update-render.ts:158-165). Verified by tests at update-render.test.ts:145-155 (hash form) and :184-195 (tag form).
  - AC2 (divergent-old header, no old ref): met — divergent=true branch returns `Updating ${label} -> ${target}  (${count} members)` (update-render.ts:167-168). Verified at :158-168 and :197-217.
  - AC3 (N members = attempted count): met — `count = oldCommits.length` (update-render.ts:157); caller feeds `item.updating` (the categorized-updating subset) only (update.ts:686,691). Verified at :171-182 (7 members).
  - AC5 (single reused move renderer): met — formatMemberLine reuses the same formatVersionMove (update-render.ts:227); it is one function, authored in version-resolve.ts and re-exported.
  - AC4 (interim hash-only, no tag branching): INTENTIONALLY SUPERSEDED. AC4 is a phase-local INTERIM constraint that task 2-2 itself repeatedly flags for Phase 3 rewording ("Do NOT encode the tag rule here — Phase 3 rewords this one helper"). In the final state Phase 3 has landed: formatVersionMove and the divergent target now branch on isVersionTag. This is the planned sequencing, not drift. The structural AC1/2/3/5 all continue to hold, and the hash FALLBACK is still fully exercised (v4 branch, v4.0.0 commit-only move, branch/HEAD, null-old-commit → "unknown", and the shared-old-with-null-refs header). Verified — no defect.
- Justified drift from the literal task text (all consequences of Phase 3 + a well-motivated refinement, all documented and tested):
  - formatGroupHeader signature expanded from `{label, oldCommits, newCommit}` to add `oldRefs`, `newRef` (needed for the Phase-3 tag rule) and `divergent`.
  - The shared-vs-divergent `distinct = new Set(...)` decision moved OUT of formatGroupHeader to the caller (update.ts:686), threaded in as `divergent` and reused for the member-line move (update.ts:722). Rationale (documented at update-render.ts:135-146 and update.ts:683-686): a single source of truth for the header-move / member-move XOR so the two surfaces cannot drift. This is a strict improvement over deriving distinctness independently in two places, and it is guarded by dedicated tests.

TESTS:
- Status: Adequate
- Location: tests/update-render.test.ts:79-252 (formatVersionMove + formatGroupHeader)
- Coverage:
  - Shared-old header, hash and tag forms (:145-155, :184-195); divergent-old header, tagged-target and branch-target (:158-168, :197-217); attempted-count = oldCommits.length (:171-182).
  - formatVersionMove: tag move (:80-89), v4 branch clean()-null → hash (:91-100), v4.0.0 commit-only move oldRef===newRef → hash (:102-111), branch/HEAD null/non-tag → hash (:113-130), null old commit → "unknown" (:132-141).
  - Two structural guards (:223-251) prove the caller-supplied `divergent` flag alone drives header placement (fed oldCommits whose Set size contradicts the flag in both directions) — directly protecting the relocated single-source-of-truth invariant.
- Notes:
  - The task's verbatim test name "renders the version move as short commit hashes, not tags (interim — Phase 3 rewords)" is absent; it was correctly replaced by the tag-aware + hash-fallback tests once Phase 3 landed. Its intent (hash rendering) remains well-covered. Not a gap.
  - Not over-tested: each case targets a distinct branch/edge; no redundant happy-path variants; fixtures are plain commit strings with no unnecessary mocking.
  - Would fail if the feature broke: exact-string assertions on header text, count, and tag-vs-hash selection.

CODE QUALITY:
- Project conventions: Followed. Pure formatters live in the Phase-2 rendering module; the tag-vs-hash rule is authored once in version-resolve.ts (cycle-free) and re-exported — matching the codebase's "single source" discipline seen throughout update-groups.ts.
- SOLID principles: Good. formatGroupHeader has a single responsibility (compose the header string); the divergent decision is injected rather than recomputed (DIP-flavoured, single source of truth).
- Complexity: Low. One boolean branch; no nested logic.
- Modern idioms: Yes. Discriminated inputs, template literals, `Set` for distinctness at the caller.
- Readability: Good. Intent-rich doc comments explain the divergent-flag threading and the interim→Phase-3 evolution.
- Issues: None blocking.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] src/version-resolve.ts:61-62 and src/update-render.ts:167 — the "7-char short hash" convention (`commit.slice(0, 7)`) is inlined in three places across two files (oldShort, newCommit, and the divergent target). Extract a `shortHash(commit)` helper in version-resolve.ts and route all three through it so the truncation width lives in one place. Minor DRY; no behaviour change.
