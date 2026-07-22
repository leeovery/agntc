TASK: update-output-overhaul-2-4 — Stream the actioned phase: batched check then per-group Updating spinner emitting member lines

ACCEPTANCE CRITERIA:
1. Updatable groups and local entries stream in manifest (processing) order — updatable groups at their first member's index, local group-of-one lines interleaved at their own manifest positions.
2. A standalone updatable group (member key owner/repo) collapses to one line `owner/repo: Updated <old> -> <new>`; a collection group with exactly one updating member collapses to `owner/repo/member: Updated …`, keeping the /member suffix.
3. A >=2-member updatable group emits the header (spinner) + one p.log.* line per attempted member (mixed ✓/✗/⚠ in one block).
4. A local entry emits its Refreshed line with no p.spinner() call and no clone, interleaved at its manifest position.
5. writeManifest for a group is called before any success line for that group (persistence-before-stream).
6. The spinner is not ticked per member — one start on the header, one stop on completion.
7. A non-updatable group starts no Updating spinner and emits no streamed member line.

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Unit Progress Output → Outcome timing / Per-group manifest persistence / Progress granularities / Local entries / Partial collections (Group-of-one collapse)". Two phases: a single leading "Checking for updates…" spinner resolves every group up front, then only updatable groups stream in manifest order, each under its own "Updating <repo> …" spinner that spins through the clone (no per-member tick) and emits per-member outcome lines on completion. Manifest is persisted per group right before that group's ✓. A standalone/single-updated-member group collapses to one line; a local entry (commit===null) renders as a group-of-one "Refreshed from local path" with no spinner/clone. Acceptance 2 and 5. NOTE: the task carries a user-RATIFIED note that supersedes the original Do/4a "p.log.success(outcome.summary)" collapse step: for attempted count===1, keep spin.start (animate the clone) and use spin.stop(<collapsed line>, code) as the SINGLE settled line (code 0 success/benign, code 2 error), with spinner start = "Updating <label>" (no "(N members)"). The implementation follows the ratified note, not the original Do step — an approved supersession, not drift.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/update.ts — runAllUpdates (378-445), orderWork (586-607), streamActionedWork (622-639), streamGroupWork (671-726), streamLocalWork (811-822), streamCollapsedOutcome (832-838), streamGroupMemberLines (850-869), emitMemberLine (886-914), collapsedMemberLine (790-803), failureOrSkipMemberLine (748-776), persistUnitOutcomes (926-953). Supporting: src/update-render.ts (formatGroupHeader/formatMemberLine), src/update-groups.ts (processGroupUpdate, groupTargetFacets).
- Notes:
  - AC1: orderWork positions each updatable group at its first member's manifest index and each local at its own index, then sorts — deterministic interleave. streamActionedWork iterates that list, threading a cumulative workingManifest. Correct.
  - AC2: single = item.updating.length === 1 collapses to the spinner stop-frame via collapsedMemberLine, which reuses outcome.summary (renderUpdateOutcomeSummary git-update text keyed on the FULL member key), preserving the /member suffix for a single-updated collection member. Correct.
  - AC3: multi-member path settles spin.stop(header) then streamGroupMemberLines emits one formatMemberLine per member via p.log[level] (success/error/warn) under the one header. Correct.
  - AC4: streamLocalWork reinstalls via processLocalUpdate (no cloneRepoOnce, no p.spinner) and emits streamCollapsedOutcome → p.log.success(summary). Correct.
  - AC5: persistUnitOutcomes (writeManifest) runs BEFORE the single branch's spin.stop and before the multi-member streamGroupMemberLines. Correct; the write is correctly SKIPPED for a no-op unit (no add/remove mutation).
  - AC6: exactly one spin.start + one spin.stop per group; spin.message is never called. Correct.
  - AC7: only categorized.updatableGroups reach streamGroupWork; non-updatable groups defer to the trailing collapse (task 2-5), never opening a spinner. Correct.
  - The divergent-old flag is computed once in streamGroupWork and threaded to both formatGroupHeader and streamGroupMemberLines (single source of truth for the header-move/member-move XOR). The interim per-plugin summary loop is gone; outcomes[] still feeds hasFailedOutcome (445). Group-of-one clone-failure and >=2-member clone-failure rendering (task 2-6) are correctly handled within the same function.

TESTS:
- Status: Adequate
- Coverage: tests/commands/update.test.ts "streamed actioned phase (task 2-4)" (1293-1775) contains all 8 plan-named tests plus 3 justified extras:
  - "streams updatable groups and local entries in manifest order" (1317) — asserts stop-frame + p.log.success ordering across git/local/git interleave via invocationCallOrder. Covers AC1.
  - "collapses a standalone updatable group to one Updated line" (1360) — asserts spin.start "Updating owner/repo", spin.stop(collapsed line, 0), no p.log.success, no "(1 members)". Covers AC2 (standalone).
  - "collapses a single updated collection member … keeping the /member suffix" (1400) — genuine-state split, asserts stop-frame carries owner/repo/a. Covers AC2 (collection).
  - "emits header + one member line per attempted member for a >=2-member group (mixed …)" (1506) — success/copy-failed/no-agents in one block, header with "(3 members)". Covers AC3.
  - "emits a local entry Refreshed line with no spinner and no clone, interleaved …" (1611) — asserts cloneSource called once, no local spinner start, ordering. Covers AC4.
  - "writes the group manifest before emitting that group ✓ (persistence before stream)" (1659) — writeOrders[0] < stopA < writeOrders[1] < stopB. Covers AC5.
  - "does not tick the spinner per member during reinstall" (1699) — handle.message not called. Covers AC6.
  - "starts no Updating spinner for a group whose members are all non-updatable" (1742) — pinned/newer-tags group opens no spinner, cloneSource once. Covers AC7.
  - Extras (1443, 1474, 1568): group-of-one copy-fail stop-frame (code 2), group-of-one no-agents stop-frame (code 0 accepted ◇), and multi-member dropped-agents parenthetical — these directly exercise the ratified group-of-one severity-code behavior and the streamed member-line composition; not redundant.
- Notes:
  - Tests assert observable behavior (spinner start/stop text+code, p.log level+text, call ordering) rather than internals — appropriate.
  - The write-before-success ordering (AC5) is asserted only for the group-of-one path (spin.stop). The >=2-member path takes the same persistUnitOutcomes-then-emit structure, so the guarantee holds, but no test pins the write-before-p.log.success ordering for the multi-member case explicitly. Minor under-coverage, structurally implied (see NON-BLOCKING).

CODE QUALITY:
- Project conventions: Followed. Small pure formatters isolated in update-render.ts; orchestration in update.ts; extensive intent-documenting comments consistent with the codebase style.
- SOLID principles: Good. SRP is clean (orderWork = ordering, streamGroupWork/streamLocalWork = one unit each, persistUnitOutcomes = persistence, formatters = pure rendering). failureOrSkipMemberLine and the divergent flag are single-sourced to prevent collapsed-vs-streamed drift.
- Complexity: Low/Acceptable. streamGroupWork's single/cloneFailed/else branch is clear; each arm is short.
- Modern idioms: Yes (discriminated WorkItem union, Set-based divergent computation, Map-based position index).
- Readability: Good. Comments explain the ratified spin.stop collapse and the code-2/code-0 severity mapping.
- Issues: None blocking.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] src/commands/update.ts:889-895 and 859-866; src/update-render.ts:196-201 — the version-move object shape `{ oldRef: string|null; newRef: string|null; oldCommit: string; newCommit: string }` is re-declared inline in emitMemberLine's `move` param, in streamGroupMemberLines' inline literal, and in MemberLineInput.move. An exported `VersionMoveInput` already exists in src/version-resolve.ts (35-39). Consolidate to one shared type (note: VersionMoveInput.oldCommit is `string | null` vs the non-null `string` these sites require — either widen at these sites or define a non-null variant).
- [quickfix] tests/commands/update.test.ts:1659 — the persistence-before-stream test (AC5) pins write-before-stop-frame only for the group-of-one path. Add one assertion that writeManifest precedes the multi-member group's first p.log.success so the >=2-member ordering guarantee is locked directly, not just structurally implied.
