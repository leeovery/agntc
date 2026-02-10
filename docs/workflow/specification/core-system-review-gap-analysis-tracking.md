---
status: in-progress
created: 2026-02-09
phase: Gap Analysis
topic: Core System
---

# Review Tracking: Core System - Gap Analysis

## Findings

### 1. Stale "local path" references in `add`

**Source**: Specification analysis
**Category**: Contradiction
**Affects**: Commands > `add`
**Priority**: Important

**Details**:
Two places still reference local paths after the decision to drop them:
- `add` description: "Installs plugins from a git repo or local path"
- `add` flow step 1: "Parse source argument (shorthand / URL / local path)"

**Proposed Addition**: Remove "or local path" and "/ local path" from both locations.
**Resolution**: Pending

---

### 2. `agntc.json` validation

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Plugin Configuration
**Priority**: Important

**Details**:
The spec defines the schema but doesn't address what happens when `agntc.json` is invalid:
- Invalid JSON (parse error)
- Missing `agents` field
- Empty `agents` array (`[]`)
- Invalid agent identifier (not "claude" or "codex")

An implementer needs to know: error and abort? Warn? Which of these are fatal?

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending

---

### 3. Bare skill copy — what files are excluded?

**Source**: Specification analysis
**Category**: Ambiguity
**Affects**: Asset Discovery and Routing > Discovery Within a Plugin
**Priority**: Important

**Details**:
For bare skills, the spec says "copy the entire plugin directory as a skill." The ignore list ("Everything else in the plugin — README, CLAUDE.md, package.json, agntc.json — is ignored") seems to apply to the asset-dir discovery path, not bare skill copying. Does `agntc.json` get copied into `.claude/skills/my-skill/agntc.json`? It shouldn't — it's not an asset. But the spec is ambiguous about what's excluded during bare skill copy.

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending

---

### 4. Manifest creation on first install

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest
**Priority**: Minor

**Details**:
The spec describes the manifest shape and how it's updated, but doesn't state that `.agntc/manifest.json` (and the `.agntc/` directory) are created on first install if they don't exist. An implementer would likely figure this out, but it's not explicit.

**Proposed Addition**: Brief note about auto-creation.
**Resolution**: Pending

---

### 5. Empty selection edge cases

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `add`
**Priority**: Important

**Details**:
Two selection points in the `add` flow don't address empty selections:
- Collection multiselect: user selects zero plugins. Cancel/abort? Error?
- Agent multiselect: user selects zero agents. Can't install without at least one agent.

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending

---

### 6. `remove`/`update` with empty manifest

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `remove`, Commands > `update`
**Priority**: Minor

**Details**:
`list` has explicit empty state handling ("No plugins installed..."). `remove` (no-arg) and `update` (no-arg) don't specify what happens with an empty manifest. Same message and exit?

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending

---

### 7. Collection with no installable subdirs

**Source**: Specification analysis
**Category**: Edge case
**Affects**: Plugin Configuration > Type Detection
**Priority**: Minor

**Details**:
Detection rule 2: "Root has no agntc.json → scan immediate subdirs for agntc.json." If no subdirs have agntc.json, the result is ambiguous. Is this case 3 ("Nothing → not an agntc repo")? Or a distinct error ("This looks like a collection but has no installable plugins")?

**Proposed Addition**: TBD — needs discussion
**Resolution**: Pending
