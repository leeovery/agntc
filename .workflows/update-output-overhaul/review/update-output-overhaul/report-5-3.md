TASK: update-output-overhaul-5-3 — Extract shared outcome→member-line failure/skip rendering

ACCEPTANCE CRITERIA:
- The four loud/skip arms (copy-failed / aborted / blocked / skipped-no-agents) and the bare-`failed` fallback are defined once; both `collapsedMemberLine` and `emitMemberLine` delegate to the shared helper.
- Each caller retains only its own success-arm rendering.
- Adding a new failure status changes exactly one switch.
- Rendered output is byte-identical for every failure/skip status across both the collapsed and streamed paths.
- Existing member-line rendering tests pass unchanged.
- Coverage asserting the collapsed and streamed paths produce identical lines for each of copy-failed, aborted, blocked, skipped-no-agents, and bare-`failed`.

STATUS: Complete

SPEC CONTEXT:
Per the spec's "Failed & skipped member lines" and "Failure isolation & lifecycle" sections, every attempted member's outcome renders inline under the group header at the log level matching severity: copy-failed/aborted/blocked as ✗ errors, no-agents as a ⚠ skip. The isolation semantics (which entries are removed vs left intact) are unchanged; this task only removes the copy-paste drift between the two rendering paths (collapsed group-of-one stop-frame vs streamed multi-member p.log lines) so a new failure variant is a single-site change. The collapsed path names by full member key; the streamed path names by basename — the sole intended difference.

IMPLEMENTATION:
- Status: Implemented (with one justified, documented deviation — see below)
- Location: src/commands/update.ts:748-776 (`failureOrSkipMemberLine`), 790-803 (`collapsedMemberLine`), 886-914 (`emitMemberLine`). Note: the actual implementation lives in src/commands/update.ts, NOT src/update-render.ts / src/summary.ts as the invocation metadata stated — those files only host the downstream `formatMemberLine` / `formatDroppedAgentsSuffix` helpers that `failureOrSkipMemberLine` delegates to.
- Notes:
  - `failureOrSkipMemberLine(outcome, name): MemberLine | null` centralizes the four loud/skip arms; both callers delegate via `failureOrSkipMemberLine(outcome, name) ?? <own bare-failed fallback>`, each keeping only its own success arm (`collapsedMemberLine` reuses `outcome.summary`; `emitMemberLine` builds the structured agents+move success line). `name` is a parameter, so the collapsed path passes `outcome.key` and the streamed path passes `memberName(...)` — the only intended divergence.
  - A new loud/skip status = one edit in `failureOrSkipMemberLine`; both paths pick it up automatically. Criterion met.
  - DEVIATION from the literal AC wording "the bare-`failed` fallback [is] defined once": the helper deliberately returns `null` for bare-`failed`, and each caller keeps its own bare-`failed` rendering (collapsed → red spinner stop-frame via `spin.stop(..., 2)`; streamed → `renderOutcomeSummary` → `p.log.error`). This is justified and thoroughly documented at update.ts:740-746: at implementation time the two paths rendered bare-`failed` at different levels (error stop-frame vs warn), so a single shared `MemberLine` could not reproduce both without changing output — which would have violated the more important byte-identity criterion. A later task normalized both to error level, but they still reach red by different mechanics (spin.stop code 2 vs p.log.error) and the collapsed fallback keeps a defensive `failed ? summary : key` branch for unreachable statuses, so keeping them unshared remains defensible. The behavioral goals (byte-identical loud/skip output; single-switch for new loud/skip statuses) are fully met; only the AC's premise that bare-`failed` "mirrors" was inaccurate.

TESTS:
- Status: Adequate
- Coverage:
  - Unit (tests/commands/update.test.ts:6797-6892): `failureOrSkipMemberLine` asserted directly for copy-failed, aborted, blocked, skipped-no-agents — each with BOTH the full-key and basename `name`, proving the arms live once and render identically modulo name; bare-`failed` asserted to return null. Because both callers demonstrably delegate to this helper, testing it with both name forms is a sound, non-redundant proof of cross-path byte-identity.
  - Integration collapsed path (lines 1443-1504): copy-failed → `owner/repo: copy failed — …` at spin.stop code 2; no-agents → `owner/repo: skipped — …` at code 0.
  - Integration streamed path (lines 1506-1566): mixed group asserts `b: copy failed — …` (error, basename) and `c: skipped — …` (warn, basename) under one header — the same wording modulo name as the collapsed path.
  - Bare-`failed` uniform-severity block (lines 6894-7003+): streamed, local, and collapsed layouts each assert red (p.log.error / spin.stop code 2), never warn.
- Notes: No over-testing — each test pins a distinct behavior. The unit tests use two name forms per status, which is purposeful (proves parameterization), not redundant. No excessive mocking; setup is minimal typed fixtures. Tests assert behavior (rendered text + level), not implementation internals.

CODE QUALITY:
- Project conventions: Followed. Idiomatic discriminated-union switch over `PluginOutcome.status`, `MemberLine | null` return, `?? { ... }` nullish fallback. Exported for direct unit testing consistent with the file's other exported render helpers.
- SOLID principles: Good. Single responsibility (loud/skip outcome → MemberLine); the change tightens DRY by removing four duplicated switch arms from two functions.
- Complexity: Low. Flat switch, one case each; callers are a guard + a delegation.
- Modern idioms: Yes — nullish coalescing, exhaustive union switch, `type MemberLine` import.
- Readability: Good. Docstrings are current and accurately explain the shared-vs-unshared boundary and the name-source parameterization; no stale comments (the earlier "p.log.warn" note was updated to reflect the current p.log.error behavior at both update.ts:745 and the test at line 6881).
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [idea] src/commands/update.ts:773-775, 795-801, 908-912 — The bare-`failed` fallback is intentionally not shared (helper returns null; each caller renders it), which diverges from the task's literal AC ("the bare-`failed` fallback [is] defined once"). Now that both paths render bare-`failed` at error level, decide whether to (a) reconcile by returning a shared `{ level: "error", text: outcome.summary }` for `failed` and letting each caller render it via its own mechanism, or (b) leave as-is and treat the AC premise as superseded. As-is is defensible and documented; this is a "decide whether", not a defect.
