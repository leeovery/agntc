TASK: 5-5 — Normalize bare-failed member-line severity to error (red) across all layouts

ACCEPTANCE CRITERIA:
- A bare `failed` member outcome renders at error (red ✗) on the streamed multi-member path, the local path, AND the group-of-one collapsed path — uniformly red.
- skipped-no-agents still renders at warn (yellow); copy-failed/aborted/blocked still render at error; no non-actioned status (up-to-date/newer-tags/check-failed/constrained-no-match) changes level.
- Exit accounting unchanged: `failed` still trips hasFailedOutcome → ExitSignal(1).
- No other observable output changes.

STATUS: Complete

SPEC CONTEXT:
USER-RATIFIED behaviour change (analysis cycle 1 follow-up). A bare `failed` outcome
(a per-member reinstall that threw, or a group-fatal clone fanned out per member)
previously rendered at inconsistent severity by layout: the group-of-one collapse
already settled a red spinner stop-frame (code 2), but the streamed multi-member and
local paths bucketed `failed` into WARN → p.log.warn → yellow. clack's spin.stop has
no warn code, so the collapse can only be green or red; red is the honest choice, so
the other paths were to normalise UP to red. Only the `failed` status's rendered level
changes; every other status is untouched, and exit accounting is unchanged.

Note: the code has since been refactored (later phases up to 8). The task-detail's
"~1037-1058 classifier that buckets outcome statuses to p.log levels" no longer exists
in that shape; the equivalent logic now lives in the small helpers below. The task's
INTENT — bare `failed` red everywhere — is fully preserved in the current code.

IMPLEMENTATION:
- Status: Implemented (behavior correct on all three layouts)
- Location:
  - src/commands/update.ts:1009-1013 renderOutcomeSummary → `failed` renders via p.log.error (RED). Sole reachable status; other statuses intentionally no-op.
  - src/commands/update.ts:886-914 emitMemberLine → for a bare `failed`, failureOrSkipMemberLine returns null → renderOutcomeSummary → p.log.error. Covers streamed multi-member (streamGroupMemberLines) AND local (streamCollapsedOutcome:832-838).
  - src/commands/update.ts:790-803 collapsedMemberLine → bare `failed` → { level: "error" } → call site (line 715) spin.stop(text, 2). Group-of-one collapse already red — unchanged, confirms uniformity.
  - src/commands/update.ts:748-776 failureOrSkipMemberLine → copy-failed/aborted/blocked → error; skipped-no-agents → warn; bare `failed` → null (deliberately not shared). Matches acceptance for the other statuses.
  - src/commands/update.ts:1015-1023 hasFailedOutcome still includes `failed` → exit accounting unchanged.
  - src/update-render.ts:222-257 formatMemberLine → no-agents = warn; copy-failed/aborted/blocked = error (unchanged).
  - Non-actioned statuses (check-failed/constrained-no-match warn, newer-tags info, up-to-date message) route via emitCollapsedGroupSummary (update.ts:972-1001) — untouched by this task.
- Notes: The group-fatal clone-failure ENUMERATED line (task 2-6, formatCloneFailureLine via p.log.error at update.ts:719) is a separate >=2-member path and is already red; the normalised path here is the per-member `failed` fallback via renderOutcomeSummary. The distinction is correctly preserved (streamed test uses a SUCCEEDING clone + per-member throw so cloneFailed === false, exercising renderOutcomeSummary rather than the enumerated line).

TESTS:
- Status: Adequate
- Coverage:
  - Streamed multi-member `failed` → p.log.error: tests/commands/update.test.ts:6904-6954 asserts p.log.error("owner/repo/b: Failed — boom"), no warn line containing "Failed", and the successful sibling still streams its ✓.
  - Local `failed` → p.log.error: tests/commands/update.test.ts:6956-6984 (stat rejects → failed → red), asserts no warn "Failed".
  - Group-of-one collapsed `failed` → spin.stop code 2: tests/commands/update.test.ts:6986-7015 asserts stopTexts(handle, 2) equals the failed line and no warn "Failed".
  - Other-status regression: tests/commands/update.test.ts:6797-6892 unit-tests failureOrSkipMemberLine — copy-failed/aborted/blocked → error, skipped-no-agents → warn, bare `failed` → null. Directly pins the "no other status's level changes" acceptance.
  - No lingering positive `failed`→warn assertions remain; all warn+"Failed" assertions are either the distinct check-failed status (correctly warn/exit-0, lines 2075/3692/3867) or negative guards that warn does NOT contain "Failed" (3518/3521/6951/6983/7014).
- Notes: Exit accounting is verified indirectly — the three new tests use `.catch(() => {})` because a `failed` outcome throws ExitSignal(1); hasFailedOutcome unchanged, so the task-4-3 exit matrix and the copy-failed/aborted/blocked exit test (line 1210) still cover it. No new exit test is warranted (behavior unchanged). Not over-tested: the three integration tests each cover a distinct layout and the unit test pins the helper's per-status mapping — no redundancy.

CODE QUALITY:
- Project conventions: Followed. Glyph supplied by log level (not embedded in text); discriminated-union outcome dispatch; single-source-of-truth helpers with thorough doc comments matching the codebase style.
- SOLID principles: Good. failureOrSkipMemberLine is the single shared loud/skip mapping; the bare-`failed` fallback is intentionally per-caller (two paths reach red by different mechanics — spinner stop-frame vs p.log.error — which no single MemberLine can express). Well-reasoned separation, documented at update.ts:740-746.
- Complexity: Low. Small, focused functions; clear branch structure.
- Modern idioms: Yes. Exhaustive switch with default null; type guards.
- Readability: Good. Intent is documented at every seam.
- Issues: None blocking.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [do-now] src/commands/update.ts:1009 — renderOutcomeSummary now handles ONLY the `failed` status (every other status is an intentional no-op), so the generic name reads as broader than it is. Consider renaming to e.g. renderFailedOutcome and updating the three doc references (update.ts:745, 883, 1004). Zero logic impact; mechanical rename with compiler backing. Marginal readability gain.
