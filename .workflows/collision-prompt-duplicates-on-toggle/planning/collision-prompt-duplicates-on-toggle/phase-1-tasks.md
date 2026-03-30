---
phase: 1
phase_name: Extract file list display and fix prompt duplication
total: 2
---

## collision-prompt-duplicates-on-toggle-1-1 | approved

### Task 1: Extract file list from select message to p.note panel

**Problem**: The `select()` calls in `collision-resolve.ts` and `unmanaged-resolve.ts` embed the full file list in the `message` parameter as a multiline string. When the rendered frame exceeds terminal height, `@clack/core`'s `restoreCursor()` cannot scroll backwards past off-screen content, causing the entire prompt block to duplicate on every arrow-key toggle.

**Solution**: Move the file list out of the `select()` message into a `note()` call rendered before each `select()`. The `note()` function renders a boxed panel that is static (not part of the interactive re-render frame), keeping the `select()` frame to 3-4 lines regardless of file count. Update the `select()` message to a short single-line string that still includes the plugin key. Update existing tests to account for the new `note()` call and changed `select()` message.

**Outcome**: Both collision and unmanaged-conflict prompts render the file list in a static `note()` panel above a short `select()` prompt. Arrow-key toggling no longer duplicates the prompt, regardless of file list length. All existing tests pass with updated assertions.

**Do**:
1. In `src/collision-resolve.ts`:
   - Add `note` to the named import from `@clack/prompts` (alongside `isCancel` and `select`)
   - Inside the `for` loop, after building `fileList` (line 31), add: `note(fileList, \`File collision with "${key}"\`)`
   - Replace the `select()` message (line 34) with: `message: \`How would you like to proceed with "${key}"?\``
2. In `src/unmanaged-resolve.ts`:
   - Add `note` to the named import from `@clack/prompts` (alongside `confirm`, `isCancel`, and `select`)
   - Inside the `for` loop, after building `fileList` (line 32), add: `note(fileList, \`Unmanaged files for "${pluginKey}"\`)`
   - Replace the `select()` message (line 35) with: `message: \`How would you like to proceed with "${pluginKey}"?\``
3. In `tests/collision-resolve.test.ts`:
   - Add `note: vi.fn()` to the mock factory return object
   - Extract `const mockedNote = vi.mocked(p.note)` after the import
   - Add a test verifying `note()` is called with the formatted file list string and title `File collision with "owner/repo-a"` before `select()` is called
   - Update existing test `"does not offer install-anyway option"` — the `select()` call's message argument changed from multiline to single-line. Verify the new message includes the plugin key but contains no file list or newlines.
4. In `tests/unmanaged-resolve.test.ts`:
   - Add `note: vi.fn()` to the mock factory return object
   - Extract `const mockedNote = vi.mocked(p.note)` after the import
   - Add a test verifying `note()` is called with the formatted file list string and title `Unmanaged files for "owner/repo-a"` before `select()` is called
   - Update existing test `"select options offer only overwrite and cancel"` — verify new single-line message format

**Acceptance Criteria**:
- [ ] `collision-resolve.ts` calls `note(fileList, ...)` with title `File collision with "${key}"` before `select()`
- [ ] `collision-resolve.ts` `select()` message is `How would you like to proceed with "${key}"?` (single-line, no file list)
- [ ] `unmanaged-resolve.ts` calls `note(fileList, ...)` with title `Unmanaged files for "${pluginKey}"` before `select()`
- [ ] `unmanaged-resolve.ts` `select()` message is `How would you like to proceed with "${pluginKey}"?` (single-line, no file list)
- [ ] Resolution logic is unchanged — same options, same branching, same outcomes
- [ ] All existing tests pass (with updated assertions for new message format)
- [ ] New tests verify `note()` is called with correct arguments

**Tests**:
- `"calls note with file list and collision title before select"` — verify `note()` receives the formatted file list and title string `File collision with "owner/repo-a"`, and is called before `select()`
- `"select message is single-line with plugin key (collision)"` — verify `select()` receives message `How would you like to proceed with "owner/repo-a"?` with no newlines
- `"calls note with file list and unmanaged title before select"` — verify `note()` receives the formatted file list and title string `Unmanaged files for "owner/repo-a"`, and is called before `select()`
- `"select message is single-line with plugin key (unmanaged)"` — verify `select()` receives message `How would you like to proceed with "owner/repo-a"?` with no newlines
- `"calls note for each collision in sequential resolution"` — with 2 collisions, `note()` is called twice with the correct respective titles
- `"calls note for each conflict in collection resolution"` — with 2 conflicts, `note()` is called twice with the correct respective plugin key titles
- `"removes colliding plugin when user chooses remove"` — existing test still passes (resolution logic unchanged)
- `"overwrite with double confirm approves files"` — existing test still passes (resolution logic unchanged)

**Edge Cases**:
- Empty file list: guarded upstream — `resolveCollisions` early-returns when `collisions.size === 0` and `resolveUnmanagedConflicts` early-returns when `conflicts.length === 0`. No `note()` call occurs in either case. Existing tests already cover this.
- Plugin key with special characters in note title: `note()` receives the key as-is (e.g., `owner/repo-a`). The `/` character is expected in all plugin keys and renders fine in clack's boxed panel. No escaping needed.

**Context**:
> The spec explicitly prescribes `p.note()` (not `p.log.info()`) for the file list display, with the plugin key as the title parameter. The exact `note()` calls and `select()` messages are specified verbatim in the specification. The existing codebase already uses `note()` with named imports in `src/init/preview-confirm.ts` — follow the same pattern.

**Spec Reference**: `.workflows/collision-prompt-duplicates-on-toggle/specification/collision-prompt-duplicates-on-toggle/specification.md`

## collision-prompt-duplicates-on-toggle-1-2 | approved

### Task 2: Add file list truncation for lists exceeding 10 files

**Problem**: When a collision or unmanaged conflict involves many files (20+, 50+, 100+), displaying every file path in the `note()` panel creates an unnecessarily long output that could still push useful content off-screen. The specification calls for truncating long file lists to keep the display concise.

**Solution**: Create a shared file-list formatting function (e.g., `formatFileList`) that takes an array of file paths, formats them as indented bullet lines, and truncates lists exceeding 10 entries by showing the first 10 files followed by an `...and N more files` summary line. Integrate this function into both `collision-resolve.ts` and `unmanaged-resolve.ts`, replacing the inline `files.map(...).join(...)` logic.

**Outcome**: File lists of 10 or fewer files display in full. Lists exceeding 10 files show the first 10 entries plus a summary line (e.g., `...and 5 more files`). Both resolve files use the same shared function for consistent formatting. The function is independently testable.

**Do**:
1. Create `src/format-file-list.ts`:
   - Export a function `formatFileList(files: string[]): string`
   - If `files.length <= 10`: return `files.map(f => \`  - \${f}\`).join("\\n")`
   - If `files.length > 10`: take the first 10, format as above, then append `\\n  ...and \${files.length - 10} more files` (note: use singular `file` when the remainder is exactly 1)
   - Export the truncation threshold as a named constant (`FILE_LIST_MAX = 10`) for test readability
2. In `src/collision-resolve.ts`:
   - Import `formatFileList` from `./format-file-list.js`
   - Replace `const fileList = files.map((f) => \`  - \${f}\`).join("\\n")` with `const fileList = formatFileList(files)`
3. In `src/unmanaged-resolve.ts`:
   - Import `formatFileList` from `./format-file-list.js`
   - Replace `const fileList = files.map((f) => \`  - \${f}\`).join("\\n")` with `const fileList = formatFileList(files)`
4. Create `tests/format-file-list.test.ts`:
   - Test the function directly with various file counts (1, 5, 10, 11, 15, 100)
   - Verify exact output format including indentation, bullet style, and summary line grammar

**Acceptance Criteria**:
- [ ] `formatFileList` exists in `src/format-file-list.ts` and is exported
- [ ] Lists of 10 or fewer files return all files formatted as `  - {path}` lines joined by newlines
- [ ] Lists of 11+ files return the first 10 formatted lines plus `  ...and N more files`
- [ ] When exactly 1 file remains after truncation (11 files total), summary reads `...and 1 more file` (singular)
- [ ] Both `collision-resolve.ts` and `unmanaged-resolve.ts` use `formatFileList` instead of inline formatting
- [ ] All existing tests continue to pass (resolve behaviour unchanged)
- [ ] New unit tests cover the formatting function directly

**Tests**:
- `"formats single file without truncation"` — 1 file returns `  - path/to/file`
- `"formats 5 files without truncation"` — all 5 files listed, no summary line
- `"formats exactly 10 files without truncation"` — all 10 files listed, no summary line (boundary)
- `"truncates 11 files with singular summary"` — first 10 files listed, followed by `  ...and 1 more file` (singular "file")
- `"truncates 15 files with plural summary"` — first 10 files listed, followed by `  ...and 5 more files` (plural "files")
- `"truncates 100 files with plural summary"` — first 10 files listed, followed by `  ...and 90 more files`
- `"each line is indented with bullet prefix"` — every non-summary line starts with `  - `
- `"summary line uses consistent indentation"` — summary line starts with `  ...and`

**Edge Cases**:
- Exactly 10 files (boundary): must display all 10 with no truncation and no summary line. This is the last count before truncation activates.
- Exactly 11 files (singular vs plural): the remainder is 1, so the summary must read `...and 1 more file` (not `files`). This is a grammar edge case.
- Single file: returns one formatted line. No truncation logic triggered.
- Very large list (100+ files): truncation works identically — first 10 shown, remainder counted in summary. No performance concern since it is simple array slicing.

**Context**:
> The specification states: "For long file lists, truncate display to the first 10 files. Append a summary line in the format `...and N more files`." Both files must use the same format for consistency. This is described as "secondary polish but in-scope since both files are already being modified." The spec does not address singular vs plural grammar, but standard English convention applies — use `file` for 1, `files` for 2+.

**Spec Reference**: `.workflows/collision-prompt-duplicates-on-toggle/specification/collision-prompt-duplicates-on-toggle/specification.md`
