---
status: complete
created: 2026-03-30
cycle: 2
phase: Input Review
topic: collision-prompt-duplicates-on-toggle
---

# Review Tracking: collision-prompt-duplicates-on-toggle - Input Review

## Findings

### 1. p.note() title text unspecified for unmanaged-resolve.ts

**Source**: Investigation — Fix Direction section + Analysis / Key files involved (lines 76, 108-113)
**Category**: Enhancement to existing topic
**Affects**: Fix section

**Details**:
The spec provides a concrete `p.note()` title example only for collision-resolve: `p.note(fileList, \`File collision with "${key}"\`)`. No equivalent title is specified for unmanaged-resolve.ts, even though the spec states "Both receive identical treatment." The current unmanaged message reads `Unmanaged files found for "${pluginKey}"`, so an analogous title is needed. Without it an implementer must invent the title text for unmanaged-resolve, which contradicts the spec's goal of fully specifying both files.

**Proposed Addition**:
Add the unmanaged-resolve `p.note()` call alongside the existing collision example: `p.note(fileList, \`Unmanaged files for "${pluginKey}"\`)`.

**Resolution**: Approved
**Notes**: Auto-approved

---
