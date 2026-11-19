TASK: 2.6 — Render a group clone failure as one enumerated grouped line

ACCEPTANCE CRITERIA:
- A group-fatal clone failure renders exactly one p.log.error line, not N lines.
- The line enumerates the affected member basenames (a, b, c) alongside the count (affects N members:) — not a count alone.
- The N failed outcomes remain in outcomes[]; hasFailedOutcome returns true and runAllUpdates throws ExitSignal(1) (exit accounting unchanged from Phase 1).
- No removeEntry/writeManifest mutation occurs for the clone-failed group.
- A sibling updatable group in the same run still streams its member lines and writes its manifest.

STATUS: Complete

SPEC CONTEXT:
Spec "Clone-failure rendering": a group-fatal clone failure renders as ONE grouped line under the group header — `owner/repo: clone failed — affects N members: a, b, c` — not N copies. The underlying model stays N `failed` outcomes for exit accounting; only the display groups. Spec "Partial collections & counts" names clone-failure as the sole exception that ENUMERATES members (vs count-collapse) because the clone is the group's single fatal action. The cloneFailed discriminator is an additive display signal over Phase 1 task 1-7's N-outcome fan-out; it does not change the outcomes array or the exit.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/update-groups.ts:236-238 — additive `GroupUpdateResult` discriminated union `{ cloneFailed: true; reason; outcomes } | { cloneFailed: false; outcomes }`.
  - src/update-groups.ts:401-408 — processGroupUpdate returns cloneFailed:true with N `failed` outcomes (one per attempted member) via `failedOutcome`; no manifest read/write on this path.
  - src/update-groups.ts:419 — success arm returns cloneFailed:false; outcomes unchanged on both arms.
  - src/update-render.ts:115-120 — pure `formatCloneFailureLine(label, memberNames)` returning `${label}: clone failed — affects ${memberNames.length} members: ${memberNames.join(", ")}` — exact wording from the task/spec.
  - src/commands/update.ts:716-719 — in streamGroupWork, for a >=2-member cloneFailed group: spin.stop(header) then p.log.error(formatCloneFailureLine(label, affected)); `affected = item.updating.map((m) => memberName(m.key))` (basenames via the shared source-parser helper — matches the task's key.split('/').pop()).
- Notes:
  - Attempted-basename derivation reuses the shared `memberName` helper (source-parser.ts:440) rather than an inline `.split('/').pop()`, which is cleaner/DRY and equivalent.
  - Group-of-one deviation (update.ts:682, 713-715, 660-669): a group with exactly one attempted member (single === true) is checked BEFORE the cloneFailed branch, so a group-of-one clone failure renders as its single collapsed `owner/repo: Failed — <msg>` spinner stop-frame (error, code 2) rather than an `affects 1 members` enumerated line. This is an underspecified edge in the task, resolved with documented reasoning (an "affects 1 members" line is redundant with the repo name and would regress the task-2-4 group-of-one collapse). It is a sound, spec-consistent interpretation, not drift — the N-line-collapse acceptance is about N>=2, and the group-of-one still keeps its single `failed` outcome, non-zero exit, and no mutation.
  - The >=2 cloneFailed path settles the header stop-frame at code 0 (neutral glyph) then emits the enumerated error line — exactly as the task specifies (`spin.stop(<header>)` with no code), matching the multi-member convention where the header is neutral and severity rides the sub-lines.

TESTS:
- Status: Adequate
- Coverage:
  - tests/update-render.test.ts:433-447 — formatCloneFailureLine: enumerates basenames with count; carries an @intent-disambiguated label verbatim (bonus).
  - tests/commands/update.test.ts:3506-3526 — one enumerated error line, not N; verifies no per-member `Failed` warn lines leak and the header spinner still starts.
  - tests/commands/update.test.ts:3528-3539 — no addEntry/removeEntry/writeManifest for the clone-failed group.
  - tests/commands/update.test.ts:3541-3551 — N failed outcomes → ExitSignal(1).
  - tests/commands/update.test.ts:3553-3618 — sibling isolation: group A collapses to one enumerated line, group B streams both member ✓ lines and persists; only B written; A never removed/added.
  - tests/commands/update.test.ts:3620-3653 — group-of-one clone failure renders ONE collapsed stop-frame (code 2), never an `affects` enumerated line (covers the deviation above).
- Notes: All five task-mandated test names are present. Tests are behavior-focused (rendered lines, manifest calls, exit signal) and not redundant — each targets a distinct criterion. The extra group-of-one and @intent-label tests cover real added behavior, not over-testing. Assertions on exact `mockLog.error`/`mockLog.success` call arrays would fail if the collapse regressed to N lines.

CODE QUALITY:
- Project conventions: Followed — pure formatter co-located in update-render.ts; single failure constructor (failedOutcome) reused; shared memberName/repoOf helpers; thorough intent-documenting comments.
- SOLID principles: Good — formatCloneFailureLine is a single-responsibility pure function; GroupUpdateResult is a clean additive discriminated union that isolates the display signal from the (unchanged) outcome model.
- DRY: Good — basenames via memberName; per-member failure summaries via failedOutcome; no duplicated wording.
- Complexity: Low — the streamGroupWork single/cloneFailed/else branch is linear and readable.
- Modern idioms: Yes — discriminated unions, narrowing, array maps.
- Readability: Good — the doc comments at update-groups.ts:225-238/357-383 and update.ts:647-669 explain the model-vs-display split and the group-of-one rationale clearly.
- Issues: One set-but-never-read field (see non-blocking notes).

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] src/update-groups.ts:237 — The `reason: string` field on the `cloneFailed: true` arm of GroupUpdateResult is set (line 404) but never read: streamGroupWork consumes only `result.cloneFailed` (update.ts:716) and builds the enumerated line from label + basenames (deliberately excluding the underlying error per spec). The failure text still lives per-member inside each `failedOutcome` summary in outcomes[]. The field was mandated by the task's additive shape, so either drop it as dead or keep it as documented forward-compat symmetry; if kept, no action needed. Concrete edit: remove `reason` from the type (237) and its construction (404), keeping the local `reason` var that feeds the per-member failedOutcome.
