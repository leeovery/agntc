---
status: in-progress
created: 2026-03-26
cycle: 1
phase: Gap Analysis
topic: cursor-agent-driver
---

# Review Tracking: cursor-agent-driver - Gap Analysis

## Findings

### 1. Persistent hint for "(not detected in project)" may not be achievable with @clack/prompts default behavior

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Agent Selection: Filter to Declared Agents

**Details**:
The spec requires the `"(not detected in project)"` hint to be "visible at all times, not just when highlighted." However, `@clack/prompts` multiselect `hint` property only renders when the option is highlighted -- this is the exact same library behavior the spec identifies as a problem for the undeclared-agent hint. The spec correctly describes the desired UX but does not address how to achieve persistent visibility. An implementer would need to decide between: (a) embedding the hint text directly in the `label` string (e.g., `label: "codex (not detected in project)"`), (b) patching/wrapping the multiselect component, or (c) some other approach. This is a design decision the spec should make, not the implementer.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 2. Collection pipeline: behavior when a plugin has zero agents after filtering

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Collection Pipeline: Silent Skip for Undeclared Agents

**Details**:
The spec says to filter `selectedAgents` to only those declared by each plugin before copying, with no warning. But it does not specify what happens when the intersection is empty -- i.e., the user selected agents that a particular plugin does not declare at all. Should the plugin be silently skipped with no manifest entry? Should it appear in results as "skipped"? Should there be any log output? Currently the pipeline copies for all selected agents and warns. With filtering, a plugin could end up with zero applicable agents. The expected behavior for this edge case should be explicit, especially regarding whether the plugin appears in the install summary.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 3. Detection description claims pattern matches both Claude and Codex, but they differ

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Cursor Driver - Detection

**Details**:
The spec states "Three-tier detection, matching the established pattern used by Claude and Codex drivers." In reality, the Codex driver uses two-tier detection (project `.agents/` directory + `which codex`) with no home directory fallback, while only the Claude driver uses three tiers. The three detection steps for Cursor are explicitly listed so an implementer would build the right thing, but the rationale text is inaccurate. It should say "matching the Claude driver pattern" or acknowledge that Codex uses a subset.

**Proposed Addition**:

**Resolution**: Pending
**Notes**: Low impact on implementation since the three tiers are explicitly enumerated. Primarily a correctness issue in the rationale text.
