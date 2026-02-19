---
status: complete
created: 2026-02-19
cycle: 2
phase: Plan Integrity Review
topic: Core System
---

# Review Tracking: Core System - Integrity

## Findings

### 1. cs-4-4 Pipeline Order Conflicts With cs-4-7 All-Dropped Agent Behavior

**Severity**: Critical
**Plan Reference**: Phase 4 / cs-4-4, cs-4-7
**Category**: Dependencies and Ordering
**Change Type**: update-task

**Details**:
cs-4-4's update pipeline is: nukeManifestFiles -> cloneSource -> readConfig -> detectType -> copy. cs-4-7 inserts agent compatibility checks between readConfig and copy. For the "all installed agents dropped" case, cs-4-7 says "don't nuke, exit 0" and the spec says "Existing files are left in place -- the user decides when to remove." But cs-4-4 has already nuked files before cloning. By the time agent compat is checked, the user's installed files are gone and cannot be preserved.

The pipeline must clone to a temp dir first, read the new config, perform the agent compat check, and only then nuke existing files if proceeding. This affects both cs-4-4 (pipeline order) and cs-4-7 (which assumes nuke hasn't happened yet).

**Current**:
cs-4-4 Do:
1. Create src/commands/update.ts with optional [key] argument
2. readManifest -> empty -> message, exit 0. No match -> error, exit 1.
3. checkForUpdate -> up-to-date -> message, exit 0. check-failed -> error, exit 1.
4. update-available: nukeManifestFiles -> cloneSource(same ref) -> readConfig -> detectType -> copy(entry.agents) -> update manifest entry -> writeManifest -> cleanup
5. Summary: old->new commit + per-agent counts
6. Register in cli.ts
7. Handle clone failure after nuke: catch cloneSource errors with context message indicating files have been removed and the plugin is in a degraded state. Surface git error clearly.

cs-4-4 Acceptance Criteria:
- Non-existent key exits 1, empty manifest exits 0, up-to-date message, check-failed error, nuke-and-reinstall pipeline, no confirmation, uses entry.agents, manifest updated with new commit/files, temp dir cleaned, post-nuke clone failure surfaces git error with context that files have been removed, temp dir cleaned on clone failure during update.

cs-4-4 Tests:
- non-existent key, empty manifest, up-to-date, check-failed, nuke-and-reinstall flow, same agents used, manifest updated, temp dir cleanup, already-deleted files, collection prefix updates all, clone failure after nuke surfaces error with degraded-state context, post-nuke clone failure cleans temp dir, all-plugins mode continues after one plugin's clone failure.

cs-4-7 Do step 3:
3. All dropped: warn with spec message (includes remove command), don't nuke, exit 0

**Proposed**:
cs-4-4 Do:
1. Create src/commands/update.ts with optional [key] argument
2. readManifest -> empty -> message, exit 0. No match -> error, exit 1.
3. checkForUpdate -> up-to-date -> message, exit 0. check-failed -> error, exit 1.
4. update-available: cloneSource(same ref) to temp dir -> readConfig from temp -> agent compat check (cs-4-7) -> if all agents dropped: warn, cleanup temp, exit 0 (existing files preserved) -> if proceeding: nukeManifestFiles -> detectType -> copy from temp (effective agents) -> update manifest entry -> writeManifest -> cleanup temp
5. Summary: old->new commit + per-agent counts
6. Register in cli.ts
7. Handle clone failure: catch cloneSource errors with clear message. No files have been modified at this point since nuke hasn't happened yet. Cleanup temp dir.

cs-4-4 Acceptance Criteria:
- Non-existent key exits 1, empty manifest exits 0, up-to-date message, check-failed error, clone-then-nuke pipeline (clone before nuke so agent compat can abort without file loss), no confirmation, uses entry.agents (or effective agents after compat check), manifest updated with new commit/files, temp dir cleaned on all paths, clone failure does not affect existing installed files (nuke has not occurred), temp dir cleaned on clone failure.

cs-4-4 Tests:
- non-existent key, empty manifest, up-to-date, check-failed, clone-then-nuke-and-reinstall flow, same agents used, manifest updated, temp dir cleanup, already-deleted files, collection prefix updates all, clone failure leaves existing files intact (no nuke occurred), all-plugins mode continues after one plugin's clone failure, all-agents-dropped aborts before nuke (files preserved).

cs-4-7 Do step 3:
3. All dropped: warn with spec message (includes remove command), return signal to abort update. Caller (cs-4-4) skips nuke and copy, cleans up temp dir, exits 0. Existing files preserved per spec.

**Resolution**: Fixed
**Notes**: The cycle 1 merge of cs-4-9 into cs-4-4 added post-nuke clone failure handling, but the root issue is that nuke should not happen before the clone and agent compat check. With the corrected pipeline, clone failure no longer creates a degraded state because nuke hasn't happened yet. This simplifies the error handling (no "files have been removed" context needed) while fixing the spec-violating behavior for all-agents-dropped.

---
