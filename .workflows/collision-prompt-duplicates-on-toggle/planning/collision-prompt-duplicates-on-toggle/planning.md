# Plan: Collision Prompt Duplicates on Toggle

## Phase 1: Extract file list display and fix prompt duplication
status: approved
approved_at: 2026-03-30

**Goal**: Eliminate prompt duplication on arrow-key toggle by moving file lists out of `select()` messages into `p.note()` panels in both `collision-resolve.ts` and `unmanaged-resolve.ts`, and add file list truncation for lists exceeding 10 files.

**Why this order**: Single-phase fix. The bug has one root cause (multiline `select()` message exceeding terminal height) manifesting identically in two files. Both files receive the same treatment and the truncation logic is tightly coupled to the same display change. Splitting would create phases without independent value.

**Acceptance**:
- [ ] `collision-resolve.ts` displays the file list via `p.note(fileList, ...)` before the `select()` prompt, with the plugin key as title
- [ ] `unmanaged-resolve.ts` displays the file list via `p.note(fileList, ...)` before the `select()` prompt, with the plugin key as title
- [ ] Both `select()` calls use a short single-line message including the plugin key (no embedded file list)
- [ ] File lists exceeding 10 files are truncated with an `...and N more files` summary line
- [ ] File lists of 10 or fewer files display in full without truncation
- [ ] Collision prompt renders without duplication on arrow-key toggle with 20+ files
- [ ] Collision prompt renders correctly with 1-2 files
- [ ] Unmanaged-conflict prompt renders without duplication on arrow-key toggle with 20+ files
- [ ] Unmanaged-conflict prompt renders correctly with 1-2 files
- [ ] Resolution logic is unchanged — same choices, same outcomes after selection
- [ ] Existing tests pass with no regressions

### Tasks
status: approved
approved_at: 2026-03-30

| # | Internal ID | Task Name | Summary | Edge Cases |
|---|-------------|-----------|---------|------------|
| 1 | collision-prompt-duplicates-on-toggle-1-1 | Extract file list from select message to p.note panel | Move file list out of `select()` message into `p.note()` display in both resolve files, replacing multiline messages with short single-line prompts, and update existing tests | empty file list (guarded by upstream), plugin key with special characters in note title |
| 2 | collision-prompt-duplicates-on-toggle-1-2 | Add file list truncation for lists exceeding 10 files | Create shared file-list formatting function that truncates lists beyond 10 entries with "...and N more files" summary line, integrate into both resolve files | exactly 10 files (boundary), exactly 11 files (singular vs plural), single file, very large list (100+ files) |
