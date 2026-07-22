TASK: 3.1 — Reword formatVersionMove to the tag-vs-hash rule and apply it across the grouped surface (update-output-overhaul-3-1)

ACCEPTANCE CRITERIA:
1. formatVersionMove returns <oldRef> -> <newRef> when both refs pass isVersionTag and oldRef !== newRef (e.g. v1.2.3 -> v1.3.0), and <oldShort> -> <newShort> otherwise, with "unknown" when oldCommit is null.
2. A v4 branch (oldRef/newRef = "v4") falls to hashes because clean("v4") is null (isVersionTag false).
3. A branch literally named v4.0.0 whose only the commit moved (oldRef === newRef === "v4.0.0") falls to hashes via the moved-guard.
4. A branch/HEAD group (newRef a branch name or null) falls to hashes; both refs being tags but the ref unmoved falls to hashes.
5. A constrained v1.2.3 -> v1.3.0 shared-old collection header renders "Updating <label>  v1.2.3 -> v1.3.0  (N members)" (tags), and each divergent-old member line renders its own <oldTag> -> v1.3.0 in tags.
6. The divergent-old header target-only display renders -> v1.3.0 (tag) when newRef is a version tag, and -> <newShort> (hash) for a branch/HEAD target.
7. The tag-vs-hash rule is authored exactly once in src/version-resolve.ts; update-render.ts consumes that same rule (no second copy of the decision logic).

STATUS: Complete

SPEC CONTEXT:
Spec "Tag-Based Summary Wording → Tags-where-tagged vs hash fallback": render the version move in tags only when BOTH old and new refs are genuine semver tags AND the ref actually moved; otherwise short commit hashes. The signal is never the string shape alone — isVersionTag is clean()-based, closing the update-check-fails-on-branch-ref lexical trap (clean("v4") is null → a v4 branch is not a tag). The "ref actually moved" guard exists specifically for a branch literally named v4.0.0 whose commit moved but ref name did not (oldRef === newRef). "Sourcing old/new refs": old = pre-update entry.ref, new = resolved target ref (target.tag for constrained; unchanged entry.ref/null for branch/HEAD — which is why those land on hashes). "Version move & dropped-agents placement": shared-old case → move on the group header; divergent-old case → header shows resolved target only and every updating member carries its own old -> new on its member line. Arrow note: keep the ASCII " -> " verbatim (the spec unicode → is illustrative). Acceptance 3 (Testing & Acceptance): the move renders in tags only when both refs are tags and the ref moved, on both single-key and all-mode surfaces.

IMPLEMENTATION:
- Status: Implemented (matches acceptance criteria and spec, no drift)
- Location:
  - src/version-resolve.ts:34-63 — VersionMoveInput interface + formatVersionMove, the SINGLE tag-vs-hash rule. Body is exactly the planned form: isVersionTag(oldRef) && isVersionTag(newRef) && oldRef !== newRef → `${oldRef} -> ${newRef}`; else oldShort ("unknown" when null) -> newShort. Reuses the existing clean()-based isVersionTag (version-resolve.ts:30) — no re-implemented string-shape detection.
  - src/update-render.ts:4,10 — imports and re-exports formatVersionMove from version-resolve.js, so Phase 2 callers/tests keep the same import surface while the decision lives in one place.
  - src/update-render.ts:148-169 formatGroupHeader — extended with oldRefs:(string|null)[] and newRef:string|null. Shared-old branch (divergent=false) routes through formatVersionMove({ oldRef: oldRefs[0]!, newRef, oldCommit: oldCommits[0]!, newCommit }); divergent branch renders target-only `Updating ${label} -> ${isVersionTag(newRef) ? newRef : newCommit.slice(0,7)}  (${count} members)`.
  - src/update-render.ts:190-257 formatMemberLine — move field carries { oldRef, newRef, oldCommit, newCommit }; the parenthetical is built from formatVersionMove(move).
  - src/commands/update.ts:671-726 streamGroupWork — threads oldRefs = item.updating.map(m => m.entry.ref), newRef = groupTargetFacets(...).displayRef, and a single divergent flag (Set of installed commits) into both the header and member-line renderers.
  - src/update-groups.ts:276-297 groupTargetFacets.displayRef — the single source of newRef: target.tag for constrained, group.versionIntent (branch name or null) for branch/head. Correct per plan/spec.
- Notes: The divergent-old header's target-only display (update-render.ts:167) uses a distinct single-ref `isVersionTag(newRef) ? newRef : hash` render rather than the two-ref formatVersionMove — this is exactly what the plan prescribes (the two-ref move rule "cannot apply" with no shared old), not a duplicated copy of the decision. The name→agents separator on member lines uses the unicode " → " (per renderCollectionAddSummary convention); the version-move token inside the parenthetical correctly uses the ASCII " -> " from formatVersionMove. Arrow requirement honoured.

TESTS:
- Status: Adequate
- Coverage: All nine planned tests are present and assert the acceptance criteria:
  - tests/update-render.test.ts:79-142 — formatVersionMove: tag move (80), v4 branch → hash (91), v4.0.0 unmoved → hash (102), branch/HEAD null/non-tag → hash (113), null old commit → "unknown" (132).
  - tests/update-render.test.ts:184-217 — shared-old header tag move (184); divergent-old header target-only tag vs branch hash (197).
  - tests/update-render.test.ts:266-299 — divergent-old member line move: hash variant (266) and tag variant (281).
  - tests/commands/update.test.ts:1792 — grouped streaming threads old=members' entry.ref, new=resolved target.tag into a shared-old header ("Updating owner/repo  v1.2.3 -> v1.3.0  (2 members)"); :1825 — divergent-old constrained members each carry their own <oldTag> -> v1.3.0.
  - AC4 "both tags but ref unmoved → hashes" is covered by the v4.0.0 oldRef===newRef case (both pass isVersionTag, moved-guard sends to hash).
  - formatVersionMove is authored in version-resolve.ts but tested via the update-render.js re-export (same function object) — the plan explicitly routes these tests to update-render.test.ts; version-resolve.test.ts independently covers the underlying isVersionTag primitive (161-185). No coverage gap.
- Notes: The two structural-guard suites (update-render.test.ts:223-251 and update.test.ts:1874-1943) deliberately feed oldCommits/updating-commit Set sizes that CONTRADICT the passed divergent flag, proving the caller-supplied flag (single source of truth in streamGroupWork) — not an internally re-derived Set — drives header-move/member-move placement. This locks the anti-drift invariant and is not redundant. Not over-tested: each test asserts a distinct branch or invariant; no duplicated happy-path variations.

CODE QUALITY:
- Project conventions: Followed. Tab indentation, .js import extensions, discriminated unions (MemberLineInput), pure formatting functions separated from I/O — consistent with the codebase. No frontmatter/string-shape parsing (configless-detection ethos respected: ref classification goes through clean()-based isVersionTag, not regex).
- SOLID principles: Good. formatVersionMove is a single-responsibility pure function; the rule has exactly one home; the divergent flag is computed once and injected (dependency-injection of the decision), preventing the header/member surfaces from re-deriving and drifting.
- Complexity: Low. formatVersionMove is one guard + fallback; formatGroupHeader is a single if/else.
- Modern idioms: Yes. Template literals, Set-based distinct check, structured interface inputs.
- Readability: Good. JSDoc on formatVersionMove, formatGroupHeader, and groupTargetFacets.displayRef precisely explains the tag-vs-hash rule, the moved-guard rationale, and the clone-ref-vs-display-ref distinction.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
