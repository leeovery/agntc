---
status: complete
created: 2026-02-19
cycle: 2
phase: Traceability Review
topic: Core System
---

# Review Tracking: Core System - Traceability

## Findings

### 1. Missing: Direct collection path add-command integration not covered

**Type**: Missing from plan
**Spec Reference**: Commands > add > Source Argument > "Direct path behavior: When a source points to a specific plugin within a collection (via tree URL path), the tool skips the collection multiselect and installs that plugin directly. The remainder of the flow (agent selection, collision check, copy) proceeds as normal."
**Plan Reference**: cs-3-7 (Source Parsing: Direct Collection Path), tick-0b36b0
**Change Type**: add-to-task

**Details**:
cs-3-7 parses the direct collection path URL and extracts `targetPlugin`, `ref`, and `cloneUrl` into a `ParsedSource` variant. However, no task covers wiring this into the add command so that direct-path sources skip the collection multiselect and install the targetPlugin directly. The parsing is done but the behavioral change in the add flow is absent. cs-2-4 (Add Command: Collection Integration) only handles the multiselect flow. An implementer would parse the direct-path source but not know to skip multiselect in the add command.

**Current**:
```
**Acceptance Criteria**: Parses tree URLs with branch/tag refs, correct targetPlugin, cloneUrl, manifestKey=owner/repo/plugin, throws for @ref suffix and missing segments, no regression.

**Tests**: branch/tag refs, nested plugin paths, non-GitHub hosts, @ref suffix rejected, missing segments, no regression
```

**Proposed**:
```
**Acceptance Criteria**: Parses tree URLs with branch/tag refs, correct targetPlugin, cloneUrl, manifestKey=owner/repo/plugin, throws for @ref suffix and missing segments, no regression, add command skips collection multiselect when source is direct-path and installs targetPlugin directly, remainder of add flow (agent selection, collision check, copy) proceeds as normal for direct-path sources.

**Tests**: branch/tag refs, nested plugin paths, non-GitHub hosts, @ref suffix rejected, missing segments, no regression, add command bypasses collection multiselect for direct-path source, direct-path installs only the specified plugin, direct-path proceeds through agent selection and conflict checks normally, direct-path with targetPlugin not found in collection errors clearly
```

**Resolution**: Fixed
**Notes**: The spec explicitly calls out that direct-path sources skip the collection multiselect. Without this in any task's acceptance criteria, an implementer could parse the URL correctly but still show the multiselect for direct-path sources.
