TASK: update-output-overhaul-8-1 — Remove group-collapse redesign's dead presentation residue

ACCEPTANCE CRITERIA:
- The four non-actioned PluginOutcome variants (up-to-date / newer-tags / check-failed / constrained-no-match) no longer carry a `summary` field, and no code constructs display sentences for them.
- `renderOutcomeSummary` contains only its reachable `failed` case (or is inlined + deleted); no unreachable per-status branches remain.
- `OutOfConstraintInfo` has no `constraint` field; no producer or test sets one.
- `npm test` passes with the same test count as before (1729) and `tsc` typecheck is clean.
- CLI output for all-mode and single-key update runs (up-to-date, newer-tags, check-failed, constrained-no-match, and out-of-constraint footer) is unchanged.

STATUS: Complete

SPEC CONTEXT: The group-collapse redesign (Phases 1-2) moved all non-actioned category rendering to the per-group update-render.ts formatters (emitCollapsedGroupSummary → formatUpToDateLine / formatNewerTagsLine / formatCheckFailedLine / formatConstrainedNoMatchLine). Per spec "Partial collections & counts" and "Outcome timing", the non-actioned categories collapse to one line per group via those formatters; the per-member PluginOutcome model exists only for exit accounting (hasFailedOutcome) and manifest persistence, not for display of non-actioned categories. This task removes the superseded per-member wording that the redesign left behind as write-only dead code, plus the write-only OutOfConstraintInfo.constraint field (spec's actionable footer wording, "Blocking message", never reads constraint — it uses current/latestOverall/repo).

IMPLEMENTATION:
- Status: Implemented — all six "Do" items landed exactly (commit 438855e), no drift.
- Location:
  - src/update-groups.ts:113-121 — the four non-actioned PluginOutcome variants are now lean `{ status; key }`; updated/refreshed/failed/copy-failed/aborted/blocked/skipped-no-agents retain `summary` (genuinely read).
  - src/commands/update.ts:546-575 (splitMember) — newer-tags / check-failed / constrained-no-match now return `{ status, key }`; the dead per-member sentence construction (including the newestTag(result.tags) newer-tags string) removed.
  - src/commands/update.ts:577-579 (upToDateOutcome) — returns lean `{ status: "up-to-date", key }`.
  - src/commands/update.ts:1003-1013 (renderOutcomeSummary) — trimmed to the sole reachable `failed → p.log.error(outcome.summary)` case; the unreachable success/copy-failed/aborted/blocked/warn/info/message branches removed; documenting comment records the reachability invariant.
  - src/commands/update.ts:794-801 (collapsedMemberLine fallback) — the bare-`failed` fallback now narrows via `outcome.status === "failed" ? outcome.summary : outcome.key`, TS-safe after the lean variants dropped `.summary`.
  - src/summary.ts:310-340 (OutOfConstraintInfo) — `constraint: string` field + its doc comment removed; renderOutOfConstraintSection unchanged (never read it).
  - src/commands/update.ts:116-144 (extractOutOfConstraint, single-key) and :519-537 (groupOutOfConstraintInfo, all-mode) — both stop feeding the dropped `constraint`.
- Notes: emitCollapsedGroupSummary, hasFailedOutcome, exit accounting, and the update-render.ts formatters are untouched (verified — task 8-1 diff touches only the two producers, the union, splitMember/upToDateOutcome, renderOutcomeSummary, the collapsedMemberLine fallback comment, and summary.ts). No orphaned imports: newestTag (update.ts:172,988), isAtOrAboveVersion (:190,557), VersionOverrides (:222) all still used. All eight remaining `.summary` reads narrow to variants that carry it (copy-failed/aborted/blocked in failureOrSkipMemberLine :757/763/769; isSuccessOutcome guards at :792/834; failed-narrowed ternary :800; failed guard :1011) — so tsc stays clean.

TESTS:
- Status: Adequate
- Coverage: The non-actioned wording assertions exercise the LIVE update-render.ts formatters, not the removed dead strings — tests/commands/update.test.ts asserts `owner/repo: 7 up to date` (:1993), `owner/repo: check failed — <reason>` lowercase (:2079,3702,3904,4231), `owner/repo: no tags satisfy ^2.0 — left untouched` (:2100,2128,3944,4234), and `owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade: npx agntc add owner/repo@v3.0` (:2018,2050). The removed write-only sentences (capital-C "Check failed", "No tags satisfy constraint — plugin left untouched", bare "Up to date", and the no-"To upgrade" "newer tags available" form) appear nowhere in tests — confirming they were never asserted, validating the task's write-only claim. tests/summary-out-of-constraint.test.ts had its six `constraint:` fixture lines removed with all output assertions unchanged (the field was never rendered).
- Notes: Test count is preserved at 1729 — the only test edit is six property-line deletions within existing cases (no test case added or removed). The `{ status: "up-to-date" }` / `"check-failed"` / `"newer-tags"` object assertions in tests/update-groups.test.ts and update-check*.test.ts are UpdateCheckResult (categorizeMember output), a separate union untouched by this task — not PluginOutcome, so no direct-construction breakage. Not over-tested: no redundant assertions added; the dead-code removal is proven by the pre-existing live-formatter tests staying green plus tsc compile-verifying the removed branches.

CODE QUALITY:
- Project conventions: Followed — discriminated-union narrowing (isSuccessOutcome / status guards), single-source formatters, no casts. Consistent with the TypeScript skills' preference for exhaustive, compiler-checked unions.
- SOLID principles: Good — the removal reinforces single-responsibility: non-actioned category wording now lives solely in update-render.ts formatters; the PluginOutcome model carries only fields that are read.
- Complexity: Low — renderOutcomeSummary collapsed from a seven-branch if/else chain to a single guard; splitMember arms simplified to lean returns.
- Modern idioms: Yes.
- Readability: Good — the trimmed renderOutcomeSummary and the collapsedMemberLine fallback both carry accurate comments documenting the reachability invariant (why only `failed` arrives), preventing a future reader from resurrecting the dead branches.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. (renderOutcomeSummary is now a single-branch, single-caller helper; the plan explicitly sanctioned EITHER trimming it OR inlining+deleting it, and the retained form carries a documenting reachability comment — inlining would be an alternative to a ratified choice, not an improvement, so it is not raised as a finding.)
