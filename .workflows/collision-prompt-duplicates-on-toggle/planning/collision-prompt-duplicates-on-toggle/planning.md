# Plan: Collision Prompt Duplicates on Toggle

## Phase 1: Extract file list display and fix prompt duplication
status: draft

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
