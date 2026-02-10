---
status: in-progress
created: 2026-02-09
phase: Input Review
topic: Core System
---

# Review Tracking: Core System - Input Review

## Findings

### 1. `add` flow ordering: file path collision check not in numbered steps

**Source**: cli-commands-ux.md (conflict handling) + deferred-items-triage.md (file path collisions)
**Category**: Gap/Ambiguity
**Affects**: Commands > `add` > Full Flow

**Details**:
The file path collision check (hard block, from deferred-items-triage) must happen BEFORE any copying begins. The asset-level conflict handling happens DURING copying. The current numbered flow jumps from step 5 (agent multiselect) to step 6 (copy with conflict handling) without showing where the collision pre-check fits. An implementer could miss that the collision check is a separate, earlier step.

**Proposed Addition**: Insert a step between 5 and 6 in the flow.
**Resolution**: Pending

---

### 2. Bare skill install naming

**Source**: core-architecture.md ("copy go-development/ to .claude/skills/go-development/")
**Category**: Enhancement to existing topic
**Affects**: Asset Discovery and Routing > Discovery Within a Plugin

**Details**:
When a bare skill is detected (SKILL.md at root), the spec says "copy the entire plugin directory as a skill" but doesn't specify what the installed skill directory is named. The core-architecture discussion gives an example: `go-development/` → `.claude/skills/go-development/`. The installed skill takes the plugin directory name.

**Proposed Addition**: Clarify that the skill is installed under its source directory name.
**Resolution**: Pending

---

### 3. Local path manifest key and update semantics

**Source**: cli-commands-ux.md (source argument formats, manifest write)
**Category**: Gap/Ambiguity
**Affects**: Manifest, Commands > `add`, Commands > `update`

**Details**:
The manifest is keyed by `owner/repo` for git sources. For local paths (`./my-plugin` or `/absolute/path`), there's no owner/repo. The discussions don't address:
- What key is used in the manifest for local path installs?
- What `ref` and `commit` values are stored? (No git remote = no SHA to compare)
- How does `update` work for locally-installed plugins? (No remote to check)

This is a genuine gap — local paths are "for development/testing" but the manifest mechanics aren't defined for them.

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending

---

### 4. Command argument validation: non-existent plugin

**Source**: Specification analysis (gap not in sources)
**Category**: Gap/Ambiguity
**Affects**: Commands > `remove`, Commands > `update`

**Details**:
The spec doesn't address what happens when `remove` or `update` is called with an argument that doesn't match any manifest entry. E.g., `npx agntc remove owner/nonexistent`. An implementer would need to decide the error message and behaviour.

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending
