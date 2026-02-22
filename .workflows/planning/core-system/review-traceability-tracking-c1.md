---
status: complete
created: 2026-02-18
cycle: 1
phase: Traceability Review
topic: Core System
---

# Review Tracking: Core System - Traceability

## Findings

### 1. Missing: Empty directories left in place after remove

**Type**: Missing from plan
**Spec Reference**: Commands > remove > "Empty directories: left in place. Agent config dirs (.claude/, .agents/) should persist regardless."
**Plan Reference**: cs-4-1 (Remove Command: Parameterized Mode), tick-35621c
**Change Type**: add-to-task

**Details**:
The spec explicitly states empty directories are left in place after removal and agent config dirs should persist. Neither cs-4-1 nor cs-4-2 mention this behavior. An implementer might add directory cleanup logic without this guidance.

**Current**:
```
**Acceptance Criteria**: Exact key removes single, prefix removes all collection plugins, non-existent exits 1 with spec message, empty manifest exits 0, confirmation shown, declined cancels, files nuked, manifest updated, summary shown.
```

**Proposed**:
```
**Acceptance Criteria**: Exact key removes single, prefix removes all collection plugins, non-existent exits 1 with spec message, empty manifest exits 0, confirmation shown, declined cancels, files nuked, manifest updated, summary shown, empty directories left in place after file deletion (no directory cleanup).

**Tests**:
- ...existing tests...
- empty parent directories left in place after removal
```

**Resolution**: Fixed
**Notes**:

---

### 2. Missing: No modification detection on remove

**Type**: Missing from plan
**Spec Reference**: Commands > remove > "No modification detection. The tool doesn't track file checksums."
**Plan Reference**: cs-4-1 (Remove Command: Parameterized Mode), tick-35621c
**Change Type**: add-to-task

**Details**:
The spec explicitly notes the tool does not track file checksums and modified files are lost on remove (git is the safety net). This is a deliberate design decision that should be in the task to prevent an implementer from adding checksum tracking.

**Current**:
```
**Context**: Spec: confirm -> delete -> remove entry -> write. nukeManifestFiles from cs-2-5. Error: "Plugin {key} is not installed."
```

**Proposed**:
```
**Context**: Spec: confirm -> delete -> remove entry -> write. nukeManifestFiles from cs-2-5. Error: "Plugin {key} is not installed." No modification detection — the tool does not track checksums. If user modified installed files, those changes are lost on remove. Git is the safety net.
```

**Resolution**: Fixed
**Notes**:

---

### 3. Missing: Existing Plugin Migration context absent from plan

**Type**: Missing from plan
**Spec Reference**: Existing Plugin Migration
**Plan Reference**: cs-3-10 (Unmanaged File Conflict Check), tick-081566
**Change Type**: add-to-task

**Details**:
The spec has an "Existing Plugin Migration" section describing how agntc's overwrite-on-conflict behavior naturally handles migration from other tools. No task mentions this or confirms the overwrite behavior serves this purpose. This is covered implicitly by the conflict handling in cs-3-10/cs-3-11 but should be noted as context.

**Current**:
```
**Context**: Spec step 8: scan for unmanaged files. Asset-level. Overwrite-all with second confirmation or cancel-plugin. After collision check passes.
```

**Proposed**:
```
**Context**: Spec step 8: scan for unmanaged files. Asset-level. Overwrite-all with second confirmation or cancel-plugin. After collision check passes. Note: overwrite-on-conflict also serves as the migration path from other tools (e.g., previous plugin managers) — no special migration tooling needed per spec.
```

**Resolution**: Fixed
**Notes**: Minor informational addition. The behavior itself is already covered.

---

### 4. Missing: Git runtime prerequisite not noted

**Type**: Missing from plan
**Spec Reference**: Dependencies > "Git — required for clone, ls-remote operations. Expected to be available on the user's system."
**Plan Reference**: cs-1-3 (Git Shallow Clone), tick-3dff00
**Change Type**: add-to-task

**Details**:
The spec states git is a runtime prerequisite. cs-1-3 should note this so the tool surfaces a clear error if git is not available rather than an opaque execFile failure.

**Current**:
```
**Context**: Spec says retry 3 times on transient, no retry on auth. Phase 1 = GitHub shorthand only, so URL is always https://github.com/{owner}/{repo}.git. Phase 3 extends for other hosts/formats. Caller owns cleanup on success; cloneSource owns cleanup on failure.
```

**Proposed**:
```
**Context**: Spec says retry 3 times on transient, no retry on auth. Phase 1 = GitHub shorthand only, so URL is always https://github.com/{owner}/{repo}.git. Phase 3 extends for other hosts/formats. Caller owns cleanup on success; cloneSource owns cleanup on failure. Git is a runtime prerequisite — the tool should surface a clear error if git is not found on the system.
```

**Resolution**: Fixed
**Notes**: Minor. The error would naturally surface from execFile failure, but making it explicit improves implementer guidance.

---

### 5. Hallucinated: cs-5-1 introduces per-plugin 5s timeout not in spec

**Type**: Hallucinated content
**Spec Reference**: N/A
**Plan Reference**: cs-5-1 (Parallel Update Check for All Plugins), tick-0f3e21
**Change Type**: update-task

**Details**:
cs-5-1 specifies "Promise.race 5s timeout per plugin" but the spec says nothing about a per-plugin timeout. The spec only says "Parallel git ls-remote calls behind a single spinner. Responsive for typical install sizes (2-10 plugins)." and that check-failed is a possible status. The 5-second timeout is an implementation detail not discussed or validated in the spec.

**Current**:
```
**Do**:
1. Create src/update-check-all.ts: checkAllForUpdates(manifest) -> Map<string, UpdateCheckResult>
2. Promise.all with Promise.race 5s timeout per plugin
3. Timeout -> check-failed. Local -> immediate.
4. Create tests mocking checkForUpdate
```

**Proposed**:
```
**Do**:
1. Create src/update-check-all.ts: checkAllForUpdates(manifest) -> Map<string, UpdateCheckResult>
2. Promise.all for parallel checks. Individual check failures -> check-failed.
3. Local -> immediate (no remote check).
4. Create tests mocking checkForUpdate
```

**Resolution**: Fixed
**Notes**: Removed hallucinated 5s timeout. Spec does not prescribe timeout behavior.

---

### 6. Hallucinated: cs-5-6 introduces tag display truncation at 50+ not in spec

**Type**: Hallucinated content
**Spec Reference**: N/A
**Plan Reference**: cs-5-6 (Detail View: Change Version Action), tick-39a172
**Change Type**: update-task

**Details**:
cs-5-6 says "Truncate display for 50+ tags" but the spec does not specify any truncation threshold for the Change version tag list. The spec says "presents a selectable list of available tags" with no truncation.

**Current**:
```
**Do**:
1. Handle change-version in list-detail.ts
2. Fetch tags, sort newest first. No tags -> message, Back. Cancel -> Back. Same tag -> message, Back.
3. Different tag: nuke-and-reinstall at new ref. Update manifest.
4. Truncate display for 50+ tags.
```

**Proposed**:
```
**Do**:
1. Handle change-version in list-detail.ts
2. Fetch tags, sort newest first. No tags -> message, Back. Cancel -> Back. Same tag -> message, Back.
3. Different tag: nuke-and-reinstall at new ref. Update manifest.
```

**Resolution**: Fixed
**Notes**: Removed hallucinated truncation. Spec does not specify truncation.

---

### 7. Hallucinated: cs-4-6 introduces "max 10" tag truncation not in spec

**Type**: Hallucinated content
**Spec Reference**: N/A
**Plan Reference**: cs-4-6 (Update Command: Tag-Pinned Behavior), tick-496cae
**Change Type**: update-task

**Details**:
cs-4-6 says "tag list (newest first, max 10)" but the spec only says "list available tags, show re-add command" with no mention of a maximum count.

**Current**:
```
**Do**:
1. Handle 'newer-tags' status in update command
2. Display: pinned to {ref}, newer tags available, tag list (newest first, max 10)
3. Show re-add command: npx agntc add {source}@{tag}
4. 'up-to-date' for tags: brief message
5. No file/manifest changes, exit 0
```

**Proposed**:
```
**Do**:
1. Handle 'newer-tags' status in update command
2. Display: pinned to {ref}, newer tags available, tag list (newest first)
3. Show re-add command: npx agntc add {source}@{tag}
4. 'up-to-date' for tags: brief message
5. No file/manifest changes, exit 0
```

**Resolution**: Fixed
**Notes**: Removed hallucinated max 10 limit.

---

### 8. Hallucinated: cs-1-4 type validation tests not in spec

**Type**: Hallucinated content
**Spec Reference**: Plugin Configuration > agntc.json > Validation
**Plan Reference**: cs-1-4 (agntc.json Validation), tick-5024dd
**Change Type**: update-task

**Details**:
cs-1-4 includes tests "throws when agents is not an array" and "throws when agents contains non-string elements". The spec validation rules are specifically enumerated: invalid JSON, missing agents field, empty agents array, and unknown agent identifiers (warn). Type validation (non-array, non-string elements) is not discussed in the spec.

**Current**:
```
**Tests**:
- returns null when agntc.json does not exist
- parses valid config with single agent
- parses valid config with multiple agents
- throws ConfigError for invalid JSON (truncated)
- throws ConfigError for invalid JSON (trailing comma)
- throws ConfigError with parse error detail
- throws when agents field missing entirely
- throws when agents is empty array
- warns for unknown agent and filters it out
- returns known agents when mix present
- warns once per unknown agent
- throws when all agents unknown
- throws when agents is not an array
- throws when agents contains non-string elements
- does not call onWarn when all agents known
- propagates permission denied errors
- reads from correct path
```

**Proposed**:
```
**Tests**:
- returns null when agntc.json does not exist
- parses valid config with single agent
- parses valid config with multiple agents
- throws ConfigError for invalid JSON (truncated)
- throws ConfigError for invalid JSON (trailing comma)
- throws ConfigError with parse error detail
- throws when agents field missing entirely
- throws when agents is empty array
- warns for unknown agent and filters it out
- returns known agents when mix present
- warns once per unknown agent
- returns empty known agents when all unknown (warns for each)
- does not call onWarn when all agents known
- propagates permission denied errors
- reads from correct path
```

**Resolution**: Fixed
**Notes**: Removed two non-spec-grounded type validation tests. All-unknown adjusted in same update (see finding 9).

---

### 9. Hallucinated: cs-1-4 throws on all-unknown agents not in spec

**Type**: Hallucinated content
**Spec Reference**: Plugin Configuration > agntc.json > Validation
**Plan Reference**: cs-1-4 (agntc.json Validation), tick-5024dd
**Change Type**: update-task

**Details**:
cs-1-4 states "If all unknown after filter, throw empty error." The spec says unknown agents warn and continue, with unknown values ignored during routing. The spec does not say to throw when all agents are unknown after filtering. The "empty agents array" error applies to the raw input, not the post-filter result.

**Current**:
```
4. Unknown agents: warn via onWarn callback, filter out. If all unknown after filter, throw empty error.
```

and in acceptance criteria:
```
- Throws when ALL agents unknown (empty after filter)
```

**Proposed**:
```
4. Unknown agents: warn via onWarn callback, filter out. Return only known agents.
```

and in acceptance criteria:
```
- Returns empty known agents array when all agents unknown (downstream handles no-valid-agents scenario)
```

**Resolution**: Fixed
**Notes**: Applied as part of finding 8. Task now returns empty known agents instead of throwing.

---

### 10. Hallucinated: cs-1-8 overwrites existing destination not in spec

**Type**: Hallucinated content
**Spec Reference**: Commands > add > Full Flow (steps 6-9 sequence)
**Plan Reference**: cs-1-8 (Bare Skill File Copy), tick-601f31
**Change Type**: update-task

**Details**:
cs-1-8 states "Overwrites existing destination (rm + copy for clean state)" as an acceptance criterion. The spec's add flow handles pre-existing files through nuke (step 6), collision check (step 7), and unmanaged conflict resolution (step 8) before the copy step (step 9). The copy step should assume a clean destination, not independently overwrite.

**Current**:
```
- Overwrites existing destination (rm + copy for clean state)
```

**Proposed**:
```
- Copies to destination (conflict handling in add flow ensures clean destination before copy)
```

**Resolution**: Fixed
**Notes**: Removed independent overwrite. Copy assumes clean destination per add flow.

---

### 11. Missing: Atomic manifest write not specified in task

**Type**: Incomplete coverage
**Spec Reference**: Commands > add > Full Flow > Step 10: "Single atomic write."
**Plan Reference**: cs-1-9 (Manifest Creation and Write), tick-aaa446
**Change Type**: add-to-task

**Details**:
The spec says manifest write should be a "single atomic write". cs-1-9 describes writeManifest as JSON.stringify + write but does not mention atomicity (write-to-temp-then-rename pattern to avoid partial writes).

**Current**:
```
3. writeManifest(projectDir, manifest) — mkdir -p .agntc/, JSON.stringify 2-space indent + trailing newline
```

**Proposed**:
```
3. writeManifest(projectDir, manifest) — mkdir -p .agntc/, JSON.stringify 2-space indent + trailing newline, atomic write (write to temp file in .agntc/ then rename to manifest.json to avoid partial writes)
```

**Resolution**: Fixed
**Notes**:

---

### 12. Missing: Rollback edge case explicit in acceptance criteria

**Type**: Incomplete coverage
**Spec Reference**: Error Handling > Rollback Edge Case
**Plan Reference**: cs-5-8 (Partial Copy Failure Rollback), tick-95a48e
**Change Type**: add-to-task

**Details**:
The spec documents: "If a copy fails after overwriting a file owned by another plugin, rollback deletes the new copy but the previous plugin's asset is already gone. Accepted as a narrow edge case." cs-5-8 Context mentions "cross-plugin overwrite accepted" but acceptance criteria and tests don't cover this explicitly.

**Current**:
```
**Acceptance Criteria**: Failure triggers rollback, tracked files deleted, ENOENT skipped, rollback failure logged not thrown, original error propagated, no manifest entry, both copy functions support rollback.
```

**Proposed**:
```
**Acceptance Criteria**: Failure triggers rollback, tracked files deleted, ENOENT skipped, rollback failure logged not thrown, original error propagated, no manifest entry, both copy functions support rollback, rollback after overwriting another plugin's file deletes the new copy (previous plugin's asset unrecoverable — accepted edge case per spec, user can update that plugin to restore).
```

**Resolution**: Fixed
**Notes**:

---

### 13. Missing: Local path error for unreadable/no-config path

**Type**: Incomplete coverage
**Spec Reference**: Error Handling > Local Path Errors > "If the local path doesn't exist, isn't readable, or contains no agntc.json: surface the error clearly and abort."
**Plan Reference**: cs-3-8 (Local Path Source Integration), tick-d24318
**Change Type**: add-to-task

**Details**:
The spec calls out local path errors specifically (unreadable, no agntc.json). cs-3-8 mentions "no agntc.json handling" in tests but acceptance criteria don't explicitly state the error behavior.

**Current**:
```
**Acceptance Criteria**: Skips clone, uses resolvedPath, no temp dir, manifest ref+commit null, key=absolute path, bare skill+plugin+collection from local path, collection keys correct, no regression.
```

**Proposed**:
```
**Acceptance Criteria**: Skips clone, uses resolvedPath, no temp dir, manifest ref+commit null, key=absolute path, bare skill+plugin+collection from local path, collection keys correct, local path with no agntc.json and no collection subdirs surfaces clear error and aborts, unreadable local path surfaces clear error and aborts, no regression.
```

**Resolution**: Fixed
**Notes**:

---

### 14. Hallucinated: cs-4-9 manifest entry removal and specific error message on post-nuke failure

**Type**: Hallucinated content
**Spec Reference**: N/A
**Plan Reference**: cs-4-9 (Update Command: Network Retry), tick-4ec9ff
**Change Type**: update-task

**Details**:
cs-4-9 invents two behaviors: (1) removing the manifest entry on clone failure after nuke, and (2) a specific error message with reinstall guidance. The spec does not define recovery behavior for post-nuke clone failure during update. These are reasonable but not spec-grounded.

**Current**:
```
**Do**:
1. Ensure cloneSource errors after nuke caught with context message
2. Post-nuke clone failure: "Update of {key} failed. Files removed. Run npx agntc add {source} to reinstall."
3. Remove stale manifest entry on clone failure
4. Verify 3x retry applies during update
5. Verify auth failure immediate abort
6. Create update-specific clone failure tests
```

**Proposed**:
```
**Do**:
1. Ensure cloneSource errors after nuke caught with context message
2. Post-nuke clone failure: surface git error clearly with context that files have been removed
3. Verify 3x retry applies during update
4. Verify auth failure immediate abort
5. Create update-specific clone failure tests
```

**Resolution**: Fixed
**Notes**: Removed hallucinated manifest entry removal and specific error text. Now surfaces git error with context only.
