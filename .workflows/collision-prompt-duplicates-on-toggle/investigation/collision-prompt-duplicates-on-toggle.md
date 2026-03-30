# Investigation: Collision Prompt Duplicates On Toggle

## Symptoms

### Problem Description

**Expected behavior:**
Arrow key toggle on collision prompt should re-render in place, showing a single prompt at all times.

**Actual behavior:**
Each arrow key press appends a new copy of the "How would you like to proceed?" prompt block, causing a rapidly growing wall of duplicated UI.

### Manifestation

- UI duplication: each arrow key toggle appends another full copy of the prompt section
- Terminal becomes unusable after a few key presses
- Secondary: file list is dense/cramped with no pagination or truncation
- Secondary: no vertical spacing between file list and action prompt

### Reproduction Steps

1. Have a plugin already installed (e.g., `leeovery/agentic-workflows`)
2. Run `npx agntc@latest add ../agentic-workflows` (local path pointing to the same plugin)
3. agntc detects file collision and presents two-option prompt
4. Toggle between options using arrow keys
5. Observe: each toggle appends another copy of the prompt

**Reproducibility:** Always

### Environment

- **Affected environments:** Local (CLI tool)
- **Browser/platform:** Terminal (Node.js CLI)
- **User conditions:** Plugin already installed, re-adding from local path

### Impact

- **Severity:** Medium
- **Scope:** All users encountering collision prompts
- **Business impact:** Core UX flow broken — collision handling is a common scenario

### References

- Relevant area: `src/commands/add.ts` (collision-handling prompt logic)

---

## Analysis

### Initial Hypotheses

- The collision prompt may be using a rendering approach that appends rather than re-renders in place (e.g., `console.log` instead of a proper interactive prompt library's re-render)
- Updated after code trace: the issue is multiline strings in `@clack/prompts` `select` message breaking cursor repositioning

### Code Trace

**Entry point:**
`src/commands/add.ts:102` — calls `resolveCollisions()` when `collisions.size > 0`

**Execution path:**
1. `src/commands/add.ts:102` — `resolveCollisions(collisions, currentManifest, projectDir)`
2. `src/collision-resolve.ts:33-45` — `select()` called with multiline message:
   ```ts
   message: `File collision with "${key}":\n${fileList}\nHow would you like to proceed?`
   ```
   The `fileList` variable itself contains newlines (one `\n` per colliding file).
3. `@clack/core` `Prompt.restoreCursor()` — counts lines in previous frame via `wrap(prevFrame).split('\n').length - 1`, then moves cursor up that many lines.
4. `@clack/core` `Prompt.render()` — uses `diffLines()` to find changed lines, then writes partial updates.

**The bug:** `@clack/core`'s `restoreCursor()` relies on accurate line counting of the previous frame. When the `message` string contains embedded `\n` characters (the file list), the frame spans many more lines than a typical single-line message. The cursor-up calculation becomes unreliable — the cursor doesn't move back far enough, so instead of overwriting the previous frame, new content is appended below it. Each arrow key toggle triggers a re-render that duplicates the entire prompt block.

**Key files involved:**
- `src/collision-resolve.ts` — constructs the multiline message for `select()`
- `src/unmanaged-resolve.ts` — same pattern, same bug (line 35)
- `node_modules/@clack/core/dist/index.mjs` — rendering logic with `restoreCursor()` and `render()`

### Root Cause

The `@clack/prompts` `select()` function's `message` parameter is intended for short, single-line messages. When a message containing many embedded newlines is passed (the collision file list), `@clack/core`'s terminal cursor management breaks. The `restoreCursor()` method miscalculates how far up to move the cursor, causing each re-render to append below the previous frame rather than overwriting it.

**Why this happens:**
The `render()` method in `@clack/core` uses `diffLines()` to optimize re-rendering — only changed lines are rewritten. But when the cursor isn't repositioned correctly (due to the multiline message), the diff-based writes land in the wrong terminal rows, causing duplication.

### Contributing Factors

- The collision file list can be very long (two pages of files), making the message string span many terminal lines
- `@clack/prompts` doesn't document or enforce single-line message constraints
- The code dumps the full file list inline in the message rather than displaying it separately before the prompt

### Why It Wasn't Caught

- The collision prompt is only triggered when re-installing over existing plugins — not a primary happy-path flow
- Manual testing likely used small file lists that didn't trigger the rendering issue
- No automated tests for interactive terminal rendering behavior

### Blast Radius

**Directly affected:**
- `src/collision-resolve.ts` — collision prompt (primary bug)
- `src/unmanaged-resolve.ts` — unmanaged file prompt (same pattern, same bug)

**Potentially affected:**
- Any other `@clack/prompts` `select()` call with multiline messages (grep found only these two)

---

## Fix Direction

*To be completed after findings review*

---

## Notes

Secondary issues noted for potential inclusion in fix:
1. File list presentation: dense, cramped, two pages of colliding files dumped inline
2. No vertical spacing between file list and action prompt
3. `unmanaged-resolve.ts` has the identical multiline message pattern and will have the same duplication bug
