---
status: in-progress
created: 2026-03-26
cycle: 1
phase: Input Review
topic: cursor-agent-driver
---

# Review Tracking: cursor-agent-driver - Input Review

## Findings

### 1. KNOWN_AGENTS location is incorrect in specification

**Source**: CURSOR-DRIVER-RESEARCH.md line 92; actual codebase src/config.ts line 10
**Category**: Enhancement to existing topic
**Affects**: Implementation section

**Details**:
The specification says "Update ... `KNOWN_AGENTS` in `src/drivers/types.ts` (or wherever it's defined)." Both the research document and the actual codebase place `KNOWN_AGENTS` in `src/config.ts`, not `src/drivers/types.ts`. The hedge "(or wherever it's defined)" suggests uncertainty that the source material already resolved.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Corrected KNOWN_AGENTS location from types.ts to config.ts

---

### 2. No implementation file references for agent selection and collection pipeline changes

**Source**: Discussion lines 112, 134 referencing src/agent-select.ts and add.ts lines 420-442
**Category**: Enhancement to existing topic
**Affects**: Agent Selection: Filter to Declared Agents, Collection Pipeline: Silent Skip, Agent Selection: Auto-Skip

**Details**:
The specification's Implementation section covers only the driver files (cursor-driver.ts, registry.ts, types.ts). The three behavioral changes (agent filtering, collection silent skip, auto-skip) describe what should change but not where. The discussion explicitly references `src/agent-select.ts` for `selectAgents()` and `add.ts` lines 420-442 for the collection pipeline warning logic. These file references would help implementation.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Implementation subsections with file references to all three behavioral change sections

---

### 3. Cursor 2.4+ minimum version context missing

**Source**: CURSOR-DRIVER-RESEARCH.md line 7; Discussion line 5
**Category**: Enhancement to existing topic
**Affects**: Cursor Driver section (top-level context)

**Details**:
Both the research document and discussion note that SKILL.md support requires Cursor 2.4+. The specification doesn't mention this. While agntc doesn't do version checking of agents, this context is relevant — detection could succeed for Cursor < 2.4 where skills won't actually work. Worth noting even if no version gate is implemented.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:
