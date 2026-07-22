---
topic: update-output-overhaul
cycle: 4
total_findings: 1
deduplicated_findings: 1
proposed_tasks: 1
---
# Analysis Report: Update Output Overhaul (Cycle 4)

## Summary
Two of three agents (duplication, standards) returned clean; the implementation is spec-conformant, typechecks, and passes the full suite. Architecture surfaced one low-severity item: dead/unreachable presentation residue left behind by the group-collapse redesign — a per-member `summary` payload in `splitMember`, unreachable per-status branches in `renderOutcomeSummary`, and a write-only `OutOfConstraintInfo.constraint` field. On inspection all three are genuinely dead (confirmed unread/unreachable/unrendered) and have already diverged in wording from the live `update-render.ts` formatters, making this a real maintenance/correctness-confusion hazard rather than a cosmetic nit. Synthesized into one contained cleanup task.

## Discarded Findings
- Version-move type literal repeated across `emitMemberLine` and `MemberLineInput.move` (duplication, sub-threshold) — a 6-line type declaration, not repeated logic; below the Rule-of-Three extraction floor and under the fourth-cycle HIGH bar.
- `list.ts` `formatLabel` re-deriving the `formatRefLabel` rule (duplication, sub-threshold) — a single ternary in pre-existing list-display code, outside this feature plan's scope.
- Three previously-deferred presentation nits (standards): ASCII `->` vs unicode arrow, group-of-one no-agents glyph lost to clack's stop-code limitation, positional 4-param signatures — deliberately deferred in cycles 1-3, not re-actioned.
