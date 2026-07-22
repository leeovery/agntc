---
topic: update-output-overhaul
cycle: 4
total_proposed: 1
---
# Analysis Tasks: Update Output Overhaul (Cycle 4)

## Task 1: Remove group-collapse redesign's dead presentation residue
status: approved
severity: low
sources: architecture

**Problem**: The group-collapse redesign moved all non-actioned category rendering (up-to-date / newer-tags / check-failed / constrained-no-match) to the per-group `update-render.ts` formatters (`emitCollapsedGroupSummary` → `formatUpToDateLine` / `formatNewerTagsLine` / `formatCheckFailedLine` / `formatConstrainedNoMatchLine`), but left the superseded per-member wording behind as dead code that has since diverged from the live formatters:
- `splitMember` (`src/commands/update.ts:567-595`) and `upToDateOutcome` (`src/commands/update.ts:593-595`) still author full per-member display sentences into the `summary` field of the four non-actioned `PluginOutcome` variants (e.g. `${key}: Check failed — ${reason}`, `${key}: No tags satisfy constraint — plugin left untouched`, `${key}: Pinned to ${ref} — newer tags available (latest: …)`, `${key}: Up to date`). These outcomes route only to `emitCollapsedGroupSummary` (reads `.status` only) and `hasFailedOutcome` (reads `.status` only); the `.summary` strings are never read and never asserted (verified: they occur solely at their construction sites). They already diverge in casing/phrasing from the live formatters (`Check failed` vs `check failed`; `No tags satisfy constraint — plugin left untouched` vs `no tags satisfy <constraint> — left untouched`; `Up to date` vs `<N> up to date`).
- `renderOutcomeSummary` (`src/commands/update.ts:1017-1038`) advertises a per-status renderer, but its only reachable input is a bare `failed` outcome (its sole call path — `emitMemberLine`'s fallback at :923, plus `streamCollapsedOutcome` at :852 — handles success first and defers copy-failed/aborted/blocked/skipped-no-agents to `failureOrSkipMemberLine`, and only ever receives reinstall-result outcomes for updating members, never the non-actioned statuses). Every branch except `failed → p.log.error` is unreachable.
- `OutOfConstraintInfo.constraint` (`src/summary.ts:341`) is a required field every producer and test must populate, but its sole consumer `renderOutOfConstraintSection` (`src/summary.ts:344-361`) never reads it — the field's own comment admits it is "no longer rendered."

This is a latent maintenance/correctness-confusion hazard: a reader sees plausible display strings and may edit the dead copy, a future change that renders outcomes directly would resurrect stale wording, and the write-only field burdens every call site and test for no effect.

**Solution**: Make the `update-render.ts` formatters the single home of non-actioned category wording by removing the dead residue, without changing any observable output. Drop the write-only `summary` payload from the non-actioned outcome variants, trim `renderOutcomeSummary` to its one reachable case, and drop the write-only `OutOfConstraintInfo.constraint` field.

**Outcome**: No dead display strings, no unreachable per-status branches, and no write-only fields remain in the update output path; the non-actioned category wording lives solely in the `update-render.ts` formatters. Observable CLI output is byte-identical, typecheck is clean, and the full suite passes.

**Do**:
1. In `src/update-groups.ts` (`PluginOutcome` union, lines 113-121), drop the `summary` field from the four non-actioned variants — `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match` — leaving them as `{ status; key }`. Leave the summary field on the variants whose summary is genuinely read (`updated`, `refreshed`, `failed`, `copy-failed`, `aborted`, `blocked`, `skipped-no-agents`).
2. In `src/commands/update.ts`, update `splitMember` (567-595) and `upToDateOutcome` (593-595) to stop constructing the per-member display sentences for those four statuses — return the lean `{ status, key }` shape.
3. In `src/commands/update.ts`, trim `renderOutcomeSummary` (1017-1038) to its one reachable path (`failed → p.log.error(outcome.summary)`), or inline that single render at the `emitMemberLine` fallback (:923) and delete the function. Remove the now type-invalid branches that read `.summary` off the non-actioned variants.
4. In `src/summary.ts`, remove the `constraint: string` field from `OutOfConstraintInfo` (341) and its doc comment (340).
5. Remove the values that producers feed the dropped field: `groupOutOfConstraintInfo` (`src/commands/update.ts:537`) and the single-key path (`src/commands/update.ts:141`). Remove any `constraint:` values that test fixtures set on `OutOfConstraintInfo` objects.
6. Do NOT alter the `update-render.ts` formatters, the `emitCollapsedGroupSummary` collapse logic, `hasFailedOutcome`, exit accounting, or any observable rendering. This is pure dead-code removal.

**Acceptance Criteria**:
- The four non-actioned `PluginOutcome` variants no longer carry a `summary` field, and no code constructs display sentences for them.
- `renderOutcomeSummary` contains only its reachable `failed` case (or is inlined and deleted); no unreachable per-status branches remain.
- `OutOfConstraintInfo` has no `constraint` field; no producer or test sets one.
- `npm test` passes with the same test count as before (1729) and `tsc` typecheck is clean.
- CLI output for all-mode and single-key update runs (up-to-date, newer-tags, check-failed, constrained-no-match, and out-of-constraint footer) is unchanged.

**Tests**:
- Run the full suite (`npm test`) and confirm all tests pass unchanged — the non-actioned wording assertions already exercise the live `update-render.ts` formatters, so their expectations must remain green with no edits to expected output strings.
- Confirm `tsc`/typecheck is clean after the union and field removals (the removed branches/values become compile-verified dead).
- Confirm existing out-of-constraint footer tests still pass after the `constraint` field and its producer/fixture values are removed (footer output unchanged).
