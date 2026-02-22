---
topic: core-system
cycle: 3
total_findings: 10
deduplicated_findings: 8
proposed_tasks: 5
---
# Analysis Report: Core System (Cycle 3)

## Summary
The dominant finding remains the CloneReinstallResult failure-reason dispatch chain repeated across 6 consumer sites in update.ts, list-update-action.ts, and list-change-version-action.ts. This was flagged in c2 and the shared `cloneAndReinstall` function was extracted, but consumers still independently dispatch on `failureReason` with identical if-chains. The architecture agent additionally identifies that the four update orchestration functions in update.ts can be unified on top of this extraction. Secondary findings include local-path validation duplication (3 sites), manifest-read-or-exit duplication (3 sites), the errorMessage extraction expression repeated 13 times, and an overly broad @ref rejection in tree URL parsing.

## Discarded Findings
- File classification by path segment duplicated (2 sites) -- low severity, only 2 call sites with slightly different return types; minimal duplication cost
- Summary render functions use string[] instead of AgentId[] -- low severity, isolated cosmetic typing issue with zero runtime impact
- Manifest entry includes undeclared cloneUrl field -- standards agent recommends no code change; pragmatically necessary for update semantics
- Collection add applies agents uniformly without per-plugin filtering -- partially addressed in c2 with per-plugin warnings; standards agent notes current behavior is defensible under spec's "warn, never block" principle
