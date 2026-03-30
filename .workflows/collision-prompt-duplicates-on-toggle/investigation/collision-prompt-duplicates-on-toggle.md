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

### Code Trace

*To be completed during analysis*

### Root Cause

*To be completed during analysis*

### Contributing Factors

*To be completed during analysis*

### Why It Wasn't Caught

*To be completed during analysis*

### Blast Radius

*To be completed during analysis*

---

## Fix Direction

*To be completed after analysis*

---

## Notes

Secondary issues noted for potential inclusion in fix:
1. File list presentation: dense, cramped, two pages of colliding files dumped inline
2. No vertical spacing between file list and action prompt
