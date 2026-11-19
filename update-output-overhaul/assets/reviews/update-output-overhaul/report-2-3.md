TASK: 2.3 — Format per-member outcome lines: glyphs, agents, move parenthetical, dropped-agents (update-output-overhaul-2-3)

ACCEPTANCE CRITERIA:
- A success with no move and no dropped agents → { level:'success', text:'<name> → <agents>' } with no parenthetical.
- A divergent-old success → <name> → <agents>  (<oldShort> -> <newShort>) carrying its own move via formatVersionMove.
- A success that dropped agents → <name> → <agents>  (codex support removed by plugin author); a success with both a move and dropped agents → one shared parenthetical, parts joined by '; '.
- copy-failed → error level, <name>: copy failed — <recovery hint>.
- aborted → error level, <name>: <abort message> carrying the recorded type and the remove+add remedy inline.
- blocked → error level, <name>: <copy-safety message> with no remove+add remedy.
- no-agents → warn level, <name>: skipped — no longer supports installed agents.

STATUS: Complete

SPEC CONTEXT:
Spec sections "Failed & skipped member lines" and "Version move & dropped-agents placement" (Per-Unit Progress Output). Every attempted member outcome renders inline under the one group header at the clack log level matching its severity (success/error/warn) — the glyph is supplied by the log level, not embedded in text. Per-member version move rides a parenthetical suffix ONLY in the divergent-old case; the dropped-agents notice rides the member line via formatDroppedAgentsSuffix; a move + drop share one parenthetical. Canonical phrase is "support removed by plugin author" (summary.ts:40). Acceptance 2 and 7.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-render.ts:170-257 (MemberLineLevel, MemberLine, MemberLineInput, formatMemberLine); src/summary.ts:32-48 (formatDroppedAgentsSuffix "parenthetical" style).
- Notes:
  - formatMemberLine returns { level, text } with a glyph-free text — matches the clack-level design (task 2-4 dispatches p.log[level](text)). Verified the consumer at src/commands/update.ts:748-914 dispatches exactly this way.
  - Success suffix is built from an ordered parts list (move pushed first, dropped-agents body second) joined by "; " inside one shared "  (...)" — so a move + drop share one parenthetical. Exactly per spec.
  - The "  (" (two-space) separator matches the acceptance-criteria/spec examples and the group-header format (formatGroupHeader), not the single-space variant in the task's "Do" prose. Two-space is the correct, consistent choice.
  - formatDroppedAgentsSuffix "parenthetical" style returns the bare body `<agents> support removed by plugin author` (no leading separator), reusing the canonical phrase from a single source — no wording drift.
  - aborted/blocked correctly share one case block (`<name>: <message>`); the remedy-vs-none distinction lives in the pre-built message (buildAbortMessage vs buildCopySafetyMessage), documented at update-render.ts:245-247.
  - Expected interim→final evolution: the task's INTERIM CONSTRAINT (hashes, two-arg formatVersionMove) has been superseded by Phase 3 — formatVersionMove is now the tag-aware object form (version-resolve.ts:53), and MemberLineInput.move carries { oldRef, newRef, oldCommit, newCommit }. This is the correct final state; formatMemberLine passes the whole move object through unchanged.
  - Integration correctness: streamGroupMemberLines (update.ts:850-869) passes `move` only when the caller-computed `divergent` flag is true — the same single flag threaded into formatGroupHeader — enforcing the spec's "per-member move only in the divergent-old case" and preventing header-move/member-move drift.

TESTS:
- Status: Adequate
- Location: tests/update-render.test.ts:254-377 (describe "formatMemberLine").
- Coverage: All 8 required tests present and behaviour-focused (exact .toEqual on { level, text }):
  1. success no-parenthetical (line 255) ✓
  2. divergent-old hash move (line 266) ✓
  3. success dropped-agents parenthetical (line 301) ✓
  4. move + drop shared parenthetical joined by ";" (line 315) ✓
  5. copy-failed error + recovery hint (line 330) ✓
  6. aborted error + recorded-type + remove/add remedy inline (line 343) ✓
  7. blocked error + copy-safety message + NO remedy (line 358) ✓
  8. no-agents warn skip (line 371) ✓
  Plus one justified extra (line 281): divergent-old success rendering its move in TAGS (v1.2.0 -> v1.3.0) — exercises the Phase-3 tag path that the final state introduced; not redundant.
- Notes:
  - Tests 6 and 7 use the real buildAbortMessage / buildCopySafetyMessage (no mocking), so they catch actual wording drift, and they verify the KEY semantic contract: aborted .toContain the recorded type + `npx agntc remove/add` remedy; blocked .not.toContain any remove/add remedy. This is exactly the spec distinction that matters.
  - Not over-tested: no redundant happy-path variations, no implementation-detail assertions, minimal setup.

CODE QUALITY:
- Project conventions: Followed. Single-source wording (canonical dropped-agents phrase), single-source move renderer (formatVersionMove in version-resolve.ts), discriminated-union input with an exhaustive switch — consistent with the codebase's factoring elsewhere.
- SOLID principles: Good. formatMemberLine is a pure single-responsibility mapping; the loud-message wording is owned upstream and merely rides the line here (dependency inversion on the pre-built message).
- Complexity: Low. One exhaustive switch; the success arm's ordered-parts assembly is linear and clear.
- Modern idioms: Yes. Discriminated union, exhaustive switch with typed return, template literals.
- Readability: Good. Doc comments explain the glyph→level convention, the shared parenthetical, and the aborted/blocked case-sharing rationale.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. (No observation survives the concrete-change floor: the .toContain assertions in the aborted/blocked tests are technically implied by the paired .toEqual, but they document the recorded-type/remedy contract as explicit intent guards and the blocked test's .not.toContain independently pins the no-remedy contract — defensible, not redundant noise.)
