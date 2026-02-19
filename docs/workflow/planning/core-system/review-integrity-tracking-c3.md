---
status: in-progress
created: 2026-02-19
cycle: 3
phase: Plan Integrity Review
topic: Core System
---

# Review Tracking: Core System - Integrity

## Findings

### 1. cs-4-5 Missing Agent Compatibility Check for Local Path Updates

**Severity**: Important
**Plan Reference**: Phase 4 / cs-4-5
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
The spec's "Agent Compatibility Changes" section says "During update, the tool re-reads the new version's agntc.json and compares its agents field against the manifest entry's agents list." This applies to all update types, not just remote updates. cs-4-5 (Local Path Re-Copy) currently describes the pipeline as "nukeManifestFiles -> copy from path using entry.agents -> update manifest" with no mention of re-reading agntc.json or checking agent compatibility.

For local path updates, the source is on disk at the stored path. Before nuking and re-copying, the tool should re-read agntc.json from that path and run the same agent compat logic from cs-4-7. If all installed agents were dropped, the spec requires "existing files are left in place" -- but cs-4-5 nukes first, making this impossible.

This is the same class of issue fixed in cycle 2 for cs-4-4 (remote updates), but for local paths. The fix is simpler: read agntc.json from the stored path (no clone needed), run agent compat check, then proceed with nuke if appropriate.

**Current**:
```
**Solution**: Detect local status from checkForUpdate. Nuke existing, re-copy from stored path (manifest key = path), update manifest. Always copies.

**Do**:
1. Local-path branch in update after checkForUpdate returns 'local'
2. Validate source path exists + is directory. Missing -> error, exit 1.
3. nukeManifestFiles -> copy from path using entry.agents -> update manifest
4. Summary: "refreshed" with counts

**Acceptance Criteria**: Local detected, always re-copies, validates path, missing path errors, no git, manifest updated with null ref/commit, works for standalone and collection local.

**Tests**: local triggers re-copy, copies even if unchanged, validates path, errors when gone, errors no agntc.json, nukes then copies, uses entry.agents, manifest updated, no git clone, no temp dir.
```

**Proposed**:
```
**Solution**: Detect local status from checkForUpdate. Re-read agntc.json from stored path, check agent compat (cs-4-7), nuke existing if proceeding, re-copy with effective agents, update manifest. Always copies unless all agents dropped.

**Do**:
1. Local-path branch in update after checkForUpdate returns 'local'
2. Validate source path exists + is directory. Missing -> error, exit 1.
3. readConfig from stored path -> agent compat check (cs-4-7) -> if all agents dropped: warn, exit 0 (existing files preserved) -> if proceeding: nukeManifestFiles -> copy from path using effective agents -> update manifest
4. Summary: "refreshed" with counts

**Acceptance Criteria**: Local detected, always re-copies, validates path, missing path errors, no git, manifest updated with null ref/commit, works for standalone and collection local, agent compat checked before nuke (re-reads agntc.json from stored path), all-agents-dropped preserves existing files, partial drop uses effective agents.

**Tests**: local triggers re-copy, copies even if unchanged, validates path, errors when gone, errors no agntc.json, agent compat checked from stored path, all-agents-dropped preserves files, partial drop uses effective agents, nukes then copies, manifest updated with effective agents, no git clone, no temp dir.
```

**Resolution**: Pending
**Notes**: Same class of issue as the cycle 2 critical finding for cs-4-4. The pipeline reorder applied to remote updates in cs-4-4 needs to be mirrored in cs-4-5 for local updates, adapted for the no-clone context (re-read agntc.json directly from the stored path instead of from a temp clone).

---

### 2. cs-5-6 Missing Clone-Before-Nuke Pipeline and Agent Compat for Change Version

**Severity**: Important
**Plan Reference**: Phase 5 / cs-5-6
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
The spec says Change version uses "same mechanics as update but with a new ref." The cycle 2 fix established that update mechanics require clone-before-nuke so agent compat can abort without file loss. cs-5-6 describes the pipeline as just "nuke-and-reinstall at new ref" without specifying clone-before-nuke order or mentioning agent compat checks.

An implementer reading cs-5-6 in isolation could implement nuke-then-clone (the old incorrect order), or skip agent compat entirely. The task should explicitly describe the correct pipeline: clone at new tag to temp -> re-read agntc.json -> agent compat check -> nuke -> copy from temp -> update manifest. This matches cs-4-4's corrected pipeline with the difference that ref is the newly selected tag.

**Current**:
```
**Do**:
1. Handle change-version in list-detail.ts
2. Fetch tags, sort newest first. No tags -> message, Back. Cancel -> Back. Same tag -> message, Back.
3. Different tag: nuke-and-reinstall at new ref. Update manifest.

**Acceptance Criteria**: Tags newest-first, no tags handled, cancel = Back, same tag message, different tag triggers reinstall, manifest updated, detail refreshes.

**Tests**: tags displayed, no tags, cancel, same tag, different tag reinstall, manifest updated, refreshed detail, network failure.
```

**Proposed**:
```
**Do**:
1. Handle change-version in list-detail.ts
2. Fetch tags, sort newest first. No tags -> message, Back. Cancel -> Back. Same tag -> message, Back.
3. Different tag: clone at new tag to temp -> re-read agntc.json -> agent compat check (reuse cs-4-7) -> if all agents dropped: warn, cleanup temp, Back -> if proceeding: nuke -> copy from temp -> update manifest with new ref + commit -> cleanup temp. Reuse cs-4-4 pipeline with new ref.

**Acceptance Criteria**: Tags newest-first, no tags handled, cancel = Back, same tag message, different tag triggers clone-before-nuke reinstall, agent compat checked before nuke, all-agents-dropped aborts (preserves files), manifest updated with new ref and commit, detail refreshes, temp dir cleaned.

**Tests**: tags displayed, no tags, cancel, same tag, different tag reinstall with clone-before-nuke, agent compat checked, all-agents-dropped preserves files, manifest updated, refreshed detail, network failure, temp dir cleanup.
```

**Resolution**: Pending
**Notes**: Same pattern as cs-5-4 fix from cycle 3 traceability review. Any task that performs nuke-and-reinstall should explicitly describe the clone-before-nuke pipeline to avoid implementing the old incorrect order.

---
