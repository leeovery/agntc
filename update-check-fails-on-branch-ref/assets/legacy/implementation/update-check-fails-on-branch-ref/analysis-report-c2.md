---
topic: update-check-fails-on-branch-ref
cycle: 2
total_findings: 5
deduplicated_findings: 4
proposed_tasks: 0
---
# Analysis Report: update-check-fails-on-branch-ref (Cycle 2)

## Summary
Cycle 2 produced five low-severity findings across the three agents and no high-severity findings. After deduplication the two ls-remote plumbing observations (re-authored line tokenisation and inline-vs-git-utils probe placement) collapse into one parser/plumbing-consolidation cluster, leaving four distinct findings. Every one is a cross-module refactor, an already-completed cycle-1 task, or a test-labelling nit that all fall outside this deliberately narrow bugfix (replace the lexical `isTagRef` classifier with a remote-truth `ls-remote` probe, confined to `src/update-check.ts` and its tests). No in-scope, actionable defect remains, so no tasks are proposed.

## Discarded Findings
- ls-remote line tokenisation re-authored in `parseRefProbe` / probe embeds git plumbing inline (duplication + architecture, low) — merged into one cluster; both call for consolidating ls-remote tokenisation/plumbing and `parseRefProbe` into `git-utils.ts`. The specification places `git-utils.ts` and cross-module refactors OUT OF SCOPE; flagged and deliberately discarded in cycle 1. The idiom is a one-to-two-line tab split and the inline pattern predates this fix.
- catch-to-check-failed mapping repeated across the four check functions (duplication, low) — three of the four catch sites predate this bugfix; extracting `toCheckFailed` would reach into pre-existing function bodies unrelated to the classifier change. Out of scope; discarded in cycle 1.
- `checkHead` refactored via the shared `compareResolvedSha` helper (standards, low) — this is the already-approved-and-completed cycle-1 task (`compareResolvedSha` consolidation), not a new defect. The refactor is behaviour-preserving and HEAD-tracking behaviour is unaffected.
- Cross-surface v4-branch "recovery" tests mock `checkForUpdate` (architecture, low) — by explicit design of task 1.3; the command/detail surfaces mock `checkForUpdate` per the codebase's established test architecture, and real classifier behaviour is proven in the task 1.2 unit tests (`tests/update-check.test.ts`). The finding concedes this "is not a coverage hole"; its recommendation is a comment/naming clarification, which would rework a test strategy that matches the spec's approach.
