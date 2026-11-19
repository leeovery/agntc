---
status: complete
created: 2026-03-30
cycle: 1
phase: Gap Analysis
topic: collision-prompt-duplicates-on-toggle
---

# Review Tracking: collision-prompt-duplicates-on-toggle - Gap Analysis

## Findings

### 1. Which clack display function to use for the file list

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Fix section

**Details**:
The spec says "Display the file list separately before the prompt (using `p.note()` or `p.log.info()`)" — offering two options without specifying which. These render quite differently: `p.note()` draws a boxed panel with an optional title, while `p.log.info()` emits a single styled log line. The visual result and the way multiline content is handled differ significantly between them. An implementer would need to make this design decision.

**Proposed Addition**:
Use `p.note()` for displaying the file list. It renders a boxed panel which visually groups the files and provides clear separation from the subsequent `select()` prompt. Pass the plugin key as the title parameter (e.g., `p.note(fileList, \`File collision with "${key}"\`)`).

**Resolution**: Approved
**Notes**: Auto-approved

---

### 2. Single-line select message text unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Fix section

**Details**:
The spec says to "pass a short single-line message to `select()`" but doesn't define what that message should say. The current messages embed the plugin key (e.g., `File collision with "${key}"`). Should the replacement single-line message still include the key for context, or is a generic "How would you like to proceed?" sufficient given the file list is now displayed separately above? Both files need a defined message. This is a UX decision the implementer would have to guess at.

**Proposed Addition**:
The replacement `select()` messages must still include the plugin key for context:
- Collision: `message: \`How would you like to proceed with "${key}"?\``
- Unmanaged: `message: \`How would you like to proceed with "${pluginKey}"?\``

**Resolution**: Approved
**Notes**: Auto-approved

---

### 3. Truncation suffix format

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: File List Truncation section

**Details**:
The spec says 'truncate display to the first 10 files with a "+N more" suffix' but the exact format string is unspecified. Possibilities include: `+5 more`, `...and 5 more files`, `(5 more files not shown)`, etc. Minor but since both files should use consistent formatting, specifying the exact template avoids divergence.

**Proposed Addition**:
Append a summary line in the format `...and N more files` (e.g., `...and 5 more files`). Both files use the same format for consistency.

**Resolution**: Approved
**Notes**: Auto-approved

