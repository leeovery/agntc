# Specification: Collision Prompt Duplicates On Toggle

## Specification

### Root Cause

The `@clack/prompts` `select()` function's `message` parameter in both `src/collision-resolve.ts` and `src/unmanaged-resolve.ts` receives a multiline string containing the full collision/conflict file list. When this list is long enough that the rendered frame exceeds terminal height, the initial render scrolls the terminal. On re-render (arrow key toggle), `@clack/core`'s `restoreCursor()` emits ANSI cursor-up commands bounded by the visible screen buffer — it cannot scroll backwards past content that has scrolled off-screen. The cursor lands partway through the frame, and subsequent writes append below rather than overwriting, duplicating the entire prompt block on each toggle.

### Fix

Move the file list out of the `select()` message parameter in both files. Display the file list separately before the prompt using `p.note()`. It renders a boxed panel which visually groups the files and provides clear separation from the subsequent `select()` prompt. Pass the plugin key as the title parameter:
- Collision: `p.note(fileList, \`File collision with "${key}"\`)`
- Unmanaged: `p.note(fileList, \`Unmanaged files for "${pluginKey}"\`)` Then pass a short single-line message to `select()`. This keeps the interactive frame small (3-4 lines) regardless of file count, avoiding the scroll overflow entirely.

The replacement `select()` messages must still include the plugin key for context:
- Collision: `message: \`How would you like to proceed with "${key}"?\``
- Unmanaged: `message: \`How would you like to proceed with "${pluginKey}"?\``

**Affected files:**
- `src/collision-resolve.ts:33-34` — collision prompt. Currently: `message: \`File collision with "${key}":\n${fileList}\nHow would you like to proceed?\``
- `src/unmanaged-resolve.ts:34-35` — unmanaged conflict prompt. Currently: `message: \`Unmanaged files found for "${pluginKey}":\n${fileList}\nHow would you like to proceed?\``

Both receive identical treatment: extract file list display, keep `select()` message single-line.

### File List Truncation

For long file lists, truncate display to the first 10 files. Append a summary line in the format `...and N more files` (e.g., `...and 5 more files`). Both files use the same format for consistency. This is secondary polish but in-scope since both files are already being modified.

### Verification

- Collision prompt renders correctly with large file lists (20+ files) — no duplication on arrow key toggle
- Collision prompt renders correctly with small file lists (1-2 files)
- Unmanaged-conflict prompt with same scenarios
- Truncation displays correctly when file count exceeds threshold
- Resolution logic unchanged — same choices, same outcomes

---

## Working Notes

[Optional - capture in-progress discussion if needed]
