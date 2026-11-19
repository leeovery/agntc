TASK: 1.8 — Check/resolve-fatal fan-out: group probe failure becomes N check-failed outcomes (update-output-overhaul-1-8)

ACCEPTANCE CRITERIA:
- A group whose resolveGroupTarget returns check-failed produces one check-failed outcome per member, each keyed to its member and carrying the shared probe reason.
- No cloneSource call occurs for a check-failed group.
- No writeManifest/addEntry/removeEntry occurs for a check-failed group.
- All-mode with only check-failed (and otherwise-successful) groups exits 0 (excluded from hasFailedOutcome); the single-key check-failed exit-1 path is untouched.
- Each check-failed member's key appears in the trailing summary output. [Phase-1 interim criterion — intentionally superseded by Phase 2 task 2-5 count-collapse; see IMPLEMENTATION.]

STATUS: Complete

SPEC CONTEXT:
Spec "Failure isolation & lifecycle / Check/resolve failure (group-level)" (specification.md:112): a per-group resolution probe can fail before any clone; every member becomes a check-failed outcome attributed to its own key; no clone/reinstall runs so there is no manifest mutation. Per the ratified exit posture ("Exit-code posture — single-key vs all-mode", specification.md:270-275), all-mode check-failed WARNS and exits 0 (excluded from hasFailedOutcome); single-key exits 1. Spec also states (specification.md:202) that check-failed is a group-level result and "count-collapses rather than enumerates" — the display shows one line per group, not per member. Acceptance 10 pins the exit posture.

IMPLEMENTATION:
- Status: Implemented (correct; evolved past the Phase-1 interim display into the ratified Phase-2 count-collapse).
- Location:
  - src/update-check.ts:201-202 — categorizeMember maps a check-failed GroupTarget to a per-member { status: "check-failed", reason } for every member (target is shared, so a check-failed group is uniformly check-failed — no mixed case is possible).
  - src/commands/update.ts:567-568 — splitMember maps that result to a { status: "check-failed", key } outcome and does NOT push to `updating`, so the group has 0 updating members.
  - src/commands/update.ts:491-499 — a group with 0 updating members is never added to updatableGroups (so it never enters streamActionedWork → no clone, no manifest write); its N outcomes land in nonActionedGroups.
  - src/commands/update.ts:430-433 — the trailing loop emits the collapsed summary and pushes the N check-failed outcomes into the run-level outcomes[] (the N-outcome accounting model is preserved).
  - src/commands/update.ts:979-982 / src/update-render.ts:89-91 — emitCollapsedGroupSummary renders one `<label>: check failed — <reason>` warn line per group, reading the reason off the shared target.
  - src/commands/update.ts:1015-1023 — hasFailedOutcome excludes check-failed (only aborted/blocked/failed/copy-failed trip exit 1) → all-mode exits 0.
  - src/commands/update.ts:478-483 — a check-failed member sets hasNotableCategory=true, so an all-check-failed run does not short-circuit into the "All plugins are up to date" outro and correctly reaches the trailing summary.
  - Single-key path unchanged: src/commands/update.ts:161-164 (runSingleUpdate still throws ExitSignal(1) on check-failed).
- Notes: The Phase-1 task literally specified stuffing the reason into each outcome's summary (`{ status: "check-failed", key, summary: "<key>: Check failed — <reason>" }`) and listing each member key in the trailing summary. The final codebase instead carries the reason once on the shared GroupTarget and count-collapses the display to one line per group (Phase 2 task 2-5). This is a deliberate, spec-mandated evolution (specification.md:202 — "count-collapse rather than enumerate"), NOT drift: the model still holds N per-member check-failed outcomes for accounting; only the display collapses. The check-failed PluginOutcome variant (update-groups.ts:115) correctly carries no summary field, since a redundant per-outcome reason would be dead data given the single shared-reason line. All observable substance of task 1-8 (fan-out per member, no clone, no manifest mutation, exit 0, single-key untouched) is satisfied.

TESTS:
- Status: Adequate
- Coverage:
  - tests/commands/update.test.ts:3687 — group probe failure → one collapsed check-failed line with the shared reason; err undefined (exit 0).
  - :3706 — check-failed group runs no clone and no addEntry/removeEntry/writeManifest.
  - :3718 and :3867 — isolation: a check-failed group alongside a succeeding sibling exits 0, the sibling still clones/updates/persists, the failed group persists nothing.
  - :3771 — the trailing display collapses to the group label with NO per-member enumeration (the Phase-2 inverse of the superseded Phase-1 criterion, asserting member keys never each surface a line).
  - :2061 — parallel task-2-5 assertion: exactly one collapsed check-failed line, no clone.
  - :3829 (matrix lock) and :2235 — single-key check-failed still exits ExitSignal(1) with the loud error (regression untouched).
  - :4154/:4201 — check-failed included in the "no non-actioned status trips the all-mode non-zero exit" sweep.
- Notes: Not under-tested — every task-1-8 acceptance criterion has a direct assertion (with the one Phase-1 display criterion correctly replaced by its Phase-2 inverse). Assertions are behavioural (exit code, clone-count, manifest-mutation calls, warn-vs-error channel, sibling isolation) and would fail if the fan-out, the no-mutation guarantee, or the exit posture regressed. Not over-tested: the apparent overlap between the task-1-8 block (:3656), the task-2-5 collapse block (:2061), and the task-4-3 posture matrix lock (:3786) is intentional and self-documented (:3805-3816) as a named regression lock per posture matrix cell; each block asserts a distinct facet. The N-outcome model count is not directly asserted, which is acceptable — for check-failed the count is unobservable (it never trips hasFailedOutcome and the display collapses), so asserting it would test an implementation detail with no behavioural consequence.

CODE QUALITY:
- Project conventions: Followed. Discriminated-union routing (GroupTarget.kind / PluginOutcome.status) with exhaustive switches; no string-shape sniffing; strict-null-aware (`versionIntent!` only where the union guarantees non-null).
- SOLID principles: Good. check-failed handling is cleanly separated by responsibility — categorizeMember (target→per-member result), splitMember (result→outcome + updating routing), emitCollapsedGroupSummary (display), hasFailedOutcome (exit gate). Single shared reason source (the target) prevents duplication/drift.
- Complexity: Low. The check-failed path is a straight fall-through: not-updatable → nonActionedGroups → one collapsed warn line.
- Modern idioms: Yes.
- Readability: Good. Extensive doc comments explain the model-vs-display split and why the reason lives on the target, not the outcome.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
