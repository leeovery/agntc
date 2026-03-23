---
status: complete
created: 2026-03-23
cycle: 1
phase: Input Review
topic: version-constraints
---

# Review Tracking: version-constraints - Input Review

## Findings

### 1. Constrained update flow mechanics with nuke-and-reinstall

**Source**: discussion/version-constraints.md, Context section ("Must work with the nuke-and-reinstall update strategy") and Manifest Storage decision
**Category**: Enhancement to existing topic
**Affects**: Update Routing (within Manifest Storage section), possibly deserves its own subsection

**Details**:
The discussion context explicitly lists "Must work with the nuke-and-reinstall update strategy" as a key constraint. The specification's update routing table states that when `constraint` is present, the behavior is "Resolve against tags, update within bounds" -- but it doesn't describe the actual update flow steps for constrained plugins.

The existing update strategy (per CLAUDE.md) is: delete manifest `files`, re-clone at same ref, re-copy for same agents. With constraints, this changes: resolve the best matching tag within constraint bounds (which may be a *different* tag than the current `ref`), then apply the standard nuke-and-reinstall at that new tag, then update `ref` and `commit` while leaving `constraint` unchanged.

The discussion established that `ref`/`commit` shift while `constraint` stays fixed, but the specification doesn't explicitly describe this as a step-by-step flow. Since the discussion flagged nuke-and-reinstall integration as a key concern, the spec should make the constrained update mechanics explicit.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Refined to include comparison logic (same/newer/older) per user feedback — never downgrade, skip if already at best match.

---

### 2. Plugin README documentation guidance

**Source**: discussion/version-constraints.md, "Should add without a constraint default to caret" section, Decision paragraph
**Category**: Enhancement to existing topic
**Affects**: Add Command Behavior section

**Details**:
The discussion explicitly states: "The documented install path for plugin READMEs is simply `agntc add owner/repo`. No version syntax in getting-started docs." This is a concrete recommendation about how the bare-add default should be communicated to plugin authors -- READMEs should advertise `agntc add owner/repo` without version syntax, keeping `@^1` and `@v1.2.3` forms as power-user territory not shown in getting-started documentation.

The specification mentions "the documented install path becomes simply `agntc add owner/repo`" in passing but doesn't capture the explicit guidance that plugin READMEs and getting-started docs should omit version syntax. This is a minor authoring-guidance detail but was a deliberate recommendation in the discussion.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added as Documentation Guidance subsection under Add Command Behavior.
