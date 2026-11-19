TASK: 5-1 — Fix malformed double-`@` re-add command in the multi-group newer-tags line (bug; Analysis Cycle 1)

ACCEPTANCE CRITERIA:
- `formatNewerTagsLine` builds its re-add command from a bare repo target and never emits a double-`@`.
- A multi-group exact-pin newer-tags render emits `npx agntc add owner/repo@<newestTag>`.
- The human line prefix still shows the disambiguated `@intent` label.
- Single-group behaviour (where `label === bare repo`) is unchanged.

STATUS: Complete

SPEC CONTEXT:
Spec "0.x-line + exact-pin edge cases" (spec:264-268) and acceptance criterion 9 require the all-mode `newer-tags` collapsed line to carry a repo-level `npx agntc add owner/repo@<newest>` command, mirroring the caret out-of-constraint footer's repo-level re-add. Per "Partial collections & counts" (spec:200-201), the trailing line collapses one-per-group and uses the *Group label* — which for a multi-group repo is `@intent`-disambiguated. The prefix (disambiguated label) and the command target (bare repo) are two semantically distinct roles; the bug conflated them, yielding `owner/repo@main@v2.0`.

IMPLEMENTATION:
- Status: Implemented (matches the task's prescribed fix — mirrors the footer's shape)
- Location:
  - src/update-render.ts:74-81 — `formatNewerTagsLine(label, commandTarget, pinnedRef, newestTag)` now takes a distinct `commandTarget`; command built as `npx agntc add ${commandTarget}@${newestTag}`, prefix from `label`. Doc comment (update-render.ts:56-73) explicitly documents the label-vs-commandTarget split and cross-references the sibling footer.
  - src/commands/update.ts:990 — caller `emitCollapsedGroupSummary` passes `formatNewerTagsLine(label, repoOf(group), group.versionIntent!, newest)`, where `label = groupLabel(group, groups)` (@intent-disambiguated) and `repoOf(group)` is the bare `owner/repo`.
- Notes: Design mirrors the sibling `renderOutOfConstraintSection` (summary.ts:342-359), which already separates the `label ?? key` prefix from a bare `repo` command field — so both trailing surfaces now share one correct shape. Only one caller of `formatNewerTagsLine` exists; no other call sites left stale. Types are sound: `repoOf` returns `string`, `group.versionIntent!` narrows `string | null` to `string` (a `tag` group always has a non-null ref intent), `newest` is a `string`.

TESTS:
- Status: Adequate (unit level); one residual end-to-end gap noted below (non-blocking)
- Coverage:
  - tests/update-render.test.ts:400-406 — single-group case: `formatNewerTagsLine("owner/repo","owner/repo","v1.0","v3.0")` asserts the bare `npx agntc add owner/repo@v3.0` (single `@`). This is the corrected baked-in assertion (previously the malformed `owner/repo@main@v2.0`).
  - tests/update-render.test.ts:408-414 — new multi-group case: label `owner/repo@main` (disambiguated) + bare target `owner/repo` asserts prefix `owner/repo@main:` yet command `npx agntc add owner/repo@v2.0` (single `@`). This is a real guard — reverting the command to build from `label` produces `owner/repo@main@v2.0` and fails the assertion.
  - Existing integration coverage: tests/commands/update.test.ts:2000-2025 and 2027-2059 exercise the caller wiring end-to-end for the SINGLE-group case (and 2057 asserts no member-scoped `owner/repo/<member>@…` leaks).
- Notes: The two unit tests are focused and non-redundant (single vs disambiguated). No over-testing. Verified no residual malformed double-`@` command string survives anywhere in tests/ or src/ (the one `owner/repo@feat@special` hit in source-parser.test.ts is an unrelated parser edge case).
  - Residual gap: no INTEGRATION test drives `emitCollapsedGroupSummary` for a *multi-group* repo whose exact-pin group has newer tags (an `@intent`-disambiguated newer-tags line). The single-group integration tests (2000/2027) cannot catch a caller-side swap because there `groupLabel === repoOf` (identical args). The multi-group integration test at 2108-2131 uses `newerTags: []`, so it never renders a newer-tags command line. The caller wiring in the multi-group case is thus guarded only at the function level (unit 408-414), not end-to-end. The task's own Tests list required only the two unit tests, both delivered — so this is a residual improvement, not a task miss.

CODE QUALITY:
- Project conventions: Followed. Positional-param formatters are the module norm (`formatUpToDateLine`, `formatCheckFailedLine`, `formatConstrainedNoMatchLine`, `formatCloneFailureLine` all positional); adding a positional `commandTarget` is consistent.
- SOLID principles: Good. Single responsibility restored — `label` (display) and `commandTarget` (command) are now separate roles; the function no longer overloads one argument for two purposes.
- Complexity: Low. Pure string formatter, no branching added.
- Modern idioms: Yes.
- Readability: Good. Doc comment (update-render.ts:56-73) clearly names the label-vs-commandTarget distinction and cross-references the footer as the precedent.
- Issues: Minor — `label` and `commandTarget` are two adjacent `string` positional params and are silently swappable by a future caller. An object param (as `formatGroupHeader` uses) would eliminate that class of error, but positional is consistent with every sibling formatter here and the sole caller is unambiguous, so this is a style preference, not a defect.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] tests/commands/update.test.ts:~2059 — add a multi-group newer-tags integration test: a manifest with two distinct-intent groups of one repo where the exact-pin group has newer tags (e.g. `owner/repo/a@v1.0` exact-pin with `newerTags: [v3.0]` and a caret `owner/repo/b@^2.0` sibling), asserting the emitted line is `owner/repo@v1.0: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade: npx agntc add owner/repo@v3.0` (disambiguated prefix, bare single-`@` command). Locks the caller wiring (`emitCollapsedGroupSummary` passing `repoOf(group)`) that the single-group integration tests can't distinguish from a swap.
