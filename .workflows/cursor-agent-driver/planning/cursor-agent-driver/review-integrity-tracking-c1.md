---
status: in-progress
created: 2026-03-27
cycle: 1
phase: Plan Integrity Review
topic: cursor-agent-driver
---

# Review Tracking: cursor-agent-driver - Integrity

## Findings

### 1. Task 2-1 Do step 8 leaves ambiguous design choice to implementer

**Severity**: Minor
**Plan Reference**: Phase 2 / cursor-agent-driver-2-1, Do step 8
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
Do step 8 says "The `selectedAgents` field on `CollectionAddSummaryInput` can remain for backward compat or be removed if nothing else uses it." This leaves a design decision to the implementer. The plan should make a clear choice. Since the task already modifies the summary interface to add per-plugin `agents`, and the purpose of the change is to replace the global `selectedAgents` with per-plugin agents, the cleaner path is to remove `selectedAgents` from `CollectionAddSummaryInput` if nothing else references it, or explicitly state it stays. Checking the task's own AC and tests: none reference `selectedAgents` on the summary input after the change, so removing it is the correct call.

**Current**:
```
8. In `renderCollectionAddSummary` in `src/summary.ts`, update the per-plugin summary to use the plugin's own agents rather than `input.selectedAgents`. Add an `agents` field (type `AgentId[]`) to the `CollectionPluginResult` interface, and pass `r.agents` instead of `input.selectedAgents` to `formatPluginSummary` and `formatBareSkillSummary`. The `selectedAgents` field on `CollectionAddSummaryInput` can remain for backward compat or be removed if nothing else uses it.
```

**Proposed**:
```
8. In `renderCollectionAddSummary` in `src/summary.ts`, update the per-plugin summary to use the plugin's own agents rather than `input.selectedAgents`. Add an `agents` field (type `AgentId[]`) to the `CollectionPluginResult` interface, and pass `r.agents` instead of `input.selectedAgents` to `formatPluginSummary` and `formatBareSkillSummary`. Remove the `selectedAgents` field from `CollectionAddSummaryInput` — it is no longer used now that each plugin carries its own agents. If a compile error surfaces elsewhere, add the field back and note the usage.
```

**Resolution**: Pending
**Notes**:

---
