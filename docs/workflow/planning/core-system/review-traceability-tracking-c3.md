---
status: in-progress
created: 2026-02-19
cycle: 3
phase: Traceability Review
topic: Core System
---

# Review Tracking: Core System - Traceability

## Findings

### 1. Inconsistency: cs-5-4 describes nuke-before-clone but cs-4-4 uses clone-before-nuke

**Type**: Incomplete coverage
**Spec Reference**: Commands > update > Update Mechanics; Commands > update > Agent Compatibility Changes ("Existing files are left in place")
**Plan Reference**: cs-5-4 (Detail View: Update Action), tick-9d07b8
**Change Type**: update-task

**Details**:
Cycle 2 corrected cs-4-4 to use a clone-before-nuke pipeline so that agent compatibility can be checked before destroying existing files (satisfying the spec's "existing files are left in place" requirement for all-agents-dropped). However, cs-5-4 still describes the old order ("Remote: nuke -> clone -> copy") in its Do section and includes a test for "clone failure after nuke" which is no longer the correct scenario. cs-5-4 says it reuses Phase 4 logic, but the description contradicts that logic. An implementer reading cs-5-4 in isolation would implement the wrong pipeline order.

**Current**:
```
**Do**:
1. Handle update action in list-detail.ts
2. Remote: nuke-and-reinstall. Local: re-copy. Reuse Phase 4 logic.
3. Success: return updated entry for refresh. Failure: show error, stay in detail.
4. Handle agent compat changes. Spinner during operations.

**Tests**: remote update, local update, success refresh, failure stays, agent compat, clone failure after nuke, temp dir cleanup.
```

**Proposed**:
```
**Do**:
1. Handle update action in list-detail.ts
2. Remote: clone to temp -> agent compat check -> nuke -> copy (reuse cs-4-4 pipeline). Local: nuke -> re-copy from path. Reuse Phase 4 logic.
3. Success: return updated entry for refresh. Failure: show error, stay in detail.
4. Handle agent compat changes (all-agents-dropped aborts before nuke, preserving existing files). Spinner during operations.

**Tests**: remote update, local update, success refresh, failure stays, agent compat, clone failure before nuke (existing files preserved), all-agents-dropped aborts before nuke, temp dir cleanup.
```

**Resolution**: Pending
**Notes**: Introduced by cycle 2's clone-before-nuke fix to cs-4-4. cs-5-4 was not updated to match.
