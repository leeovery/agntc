---
status: in-progress
created: 2026-02-12
phase: Gap Analysis
topic: Core System
---

# Review Tracking: Core System - Gap Analysis

## Findings

### 1. Reinstall via `add` — nuke step missing from flow

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `add` > Full Flow, Collection plugin selection

**Details**:
The spec says selecting an already-installed collection plugin "triggers a reinstall (nuke-and-reinstall, consistent with update strategy)." But the add flow's 10 steps don't include a nuke-before-copy step for reinstalls. Without it: (a) old assets linger if the plugin removed them in the new version, (b) asset-level conflict prompts fire for every existing asset instead of a clean replace. The "nuke-and-reinstall" description contradicts the actual flow steps.

**Proposed Addition**:
[Pending discussion]

**Resolution**: Pending
**Notes**:

---

### 2. Type detection: SKILL.md + asset dirs coexistence

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Plugin Configuration > Type Detection

**Details**:
The detection rules check SKILL.md first, then asset dirs. If a plugin has both SKILL.md at root AND asset directories (skills/, agents/, hooks/), it would be treated as a bare skill — ignoring the asset dirs entirely. The spec doesn't acknowledge this edge case or state whether SKILL.md precedence is intentional.

**Proposed Addition**:
[Pending discussion]

**Resolution**: Pending
**Notes**:

---

### 3. Ref specification for full git URLs

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `add` > Source Argument

**Details**:
GitHub shorthand supports @ref syntax (owner/repo@v2.0). Full git URLs show no way to specify a ref/tag/branch. Can you do https://github.com/owner/repo.git@v2.0? Is there a --ref flag? Or is version pinning only available via shorthand? An implementer would need to decide.

**Proposed Addition**:
[Pending discussion]

**Resolution**: Pending
**Notes**:

---

### 4. Update: changed agntc.json agents between versions

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `update` > Update Mechanics

**Details**:
Update uses the manifest's agents list, not the new version's agntc.json. If the author removes an agent from their declarations (e.g., drops Codex support), the tool still installs for the user's original agent selection with no warning. Behavior is consistent with "latest version of what I have" but the user gets no signal that the author no longer supports their configuration.

**Proposed Addition**:
[Pending discussion]

**Resolution**: Pending
**Notes**:
