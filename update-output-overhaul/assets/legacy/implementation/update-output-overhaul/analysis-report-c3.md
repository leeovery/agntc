---
topic: update-output-overhaul
cycle: 3
total_findings: 9
deduplicated_findings: 8
proposed_tasks: 2
---
# Analysis Report: Update Output Overhaul (Cycle 3)

## Summary
Third-cycle analysis confirms the implementation conforms to the specification across all acceptance criteria; the standards agent found no drift, only three low-severity presentation nits already surfaced and deliberately deferred in cycles 1-2. The two prior cycles already extracted the high-value dedup/security work (sourceSubpath guard, failedOutcome factory, isSuccessOutcome guard). What clears the bar this cycle is a narrow pair of correctness-adjacent drift risks: a never-downgrade constrained guard re-authored outside the single categorization authority, and a "divergent-old" version-move placement flag computed as two independent set-size complements across the header/member-line boundary. Everything else — the OutOfConstraintInfo parallel builders and type-hygiene, the groupTargetFacets defensive default, the triplicated up-to-date outro, and all three standards nits — was assessed and discarded as either intentional parallelism, unreachable defensive code, cosmetic, or already-deferred.

## Discarded Findings
- Version-move ASCII "->" vs unicode "→" glyph mix (standards, low) — deliberately deferred in c1; faithful to the pre-existing summary.ts move-format convention, char is not a ratified decision. Not resurrected.
- Group-of-one no-agents skip loses ⚠ glyph in spinner stop-frame (standards, low) — forced by clack's `spinner.stop` exposing only success/error codes; explicitly accepted as a clack-API limitation, signal preserved in the line text. Not resurrected.
- Four-positional-param helpers vs object-param convention (standards, low) — cosmetic, no behavioural/spec impact, assessed safe-to-defer in c2. Not worth churning working, tested code. Not resurrected.
- Parallel OutOfConstraintInfo builders across single-key and all-mode (duplication, medium) — the surface-specific post-bump-current resolution must stay in each caller regardless of any shared struct-assembly helper (the single-key path branches on `checkResult.status`, the all-mode path already holds `target.tag`), so an extraction would not actually prevent the claimed stale-current drift — the resolution it guards lives in the un-shared caller extraction. This is the single-key-vs-all-mode parallelism the spec deliberately kept separate ("Rejected: unify all four entry points"); the shareable core is a thin 5-field literal. Discarded.
- OutOfConstraintInfo dual-optional identity (`key?`/`label?`) plus dead `constraint` field (architecture, low) — type-hygiene only; the `label ?? key` fallback works today and the dead field is harmless (threaded but unread). A minor fragility, not a live defect; does not clear the third-cycle bar. Discarded.
- groupTargetFacets default arm returns empty-string commit sentinel (architecture, low) — unreachable by construction (callers pre-filter to updatable groups); purely defensive. No live defect; converting to a fail-loud throw is a reasonable hardening but does not clear the third-cycle churn bar. Discarded.
- Triplicated "already up to date" outro-and-return block in runSingleUpdate (duplication, low) — the source agent itself scoped this as a low-impact tidy worth doing only alongside the never-downgrade finding, not on its own. Partially subsumed by Task 1: folding the never-downgrade demotion into categorizeMember collapses runSingleUpdate's `constrained-update-available` never-downgrade arm into the existing `constrained-up-to-date` arm, removing one of the three copies. Discarded as a standalone task.
