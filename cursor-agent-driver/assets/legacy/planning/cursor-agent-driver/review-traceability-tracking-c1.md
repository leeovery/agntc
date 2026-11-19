---
status: complete
created: 2026-03-27
cycle: 1
phase: Traceability Review
topic: Cursor Agent Driver
---

# Review Tracking: Cursor Agent Driver - Traceability

## Findings

### 1. Missing "no version gating" constraint from spec

**Type**: Incomplete coverage
**Spec Reference**: Section "Cursor Driver", first paragraph: "agntc does not gate on Cursor version, but skills won't function on versions below 2.4"
**Plan Reference**: Phase 1 / cursor-agent-driver-1-1 (CursorDriver Implementation)
**Change Type**: add-to-task

**Details**:
The specification explicitly states "agntc does not gate on Cursor version" as a design constraint. Task 1-1 mentions "Cursor editor (2.4+)" in the Problem and "Cursor 2.4+ natively reads SKILL.md files" in Context, but does not capture the explicit constraint that the driver must NOT include any version checking logic. This is a validated spec decision that an implementer should be aware of -- without it, an implementer might reasonably add a version check to the detect() method or emit a warning for older Cursor versions.

**Current**:
```markdown
**Context**:
> The CursorDriver follows the ClaudeDriver pattern (three-tier detection) rather than the CodexDriver pattern (two-tier, no home fallback). The spec explicitly states "Three-tier detection, matching the Claude driver pattern (Codex uses two tiers -- no home directory fallback)." TARGET_DIRS is `Partial<Record<AssetType, string>>` (not full `Record`) because Cursor only supports skills -- same shape as CodexDriver. Cursor 2.4+ natively reads SKILL.md files so no format conversion is needed. The `.cursor/skills/` path is a first-class Cursor skill directory confirmed via Cursor documentation.
```

**Proposed**:
```markdown
**Context**:
> The CursorDriver follows the ClaudeDriver pattern (three-tier detection) rather than the CodexDriver pattern (two-tier, no home fallback). The spec explicitly states "Three-tier detection, matching the Claude driver pattern (Codex uses two tiers -- no home directory fallback)." TARGET_DIRS is `Partial<Record<AssetType, string>>` (not full `Record`) because Cursor only supports skills -- same shape as CodexDriver. Cursor 2.4+ natively reads SKILL.md files so no format conversion is needed. The `.cursor/skills/` path is a first-class Cursor skill directory confirmed via Cursor documentation. agntc does not gate on Cursor version -- the driver has no version checking logic. Skills won't function on Cursor versions below 2.4, but that is not agntc's concern.
```

**Resolution**: Fixed
**Notes**:

---

## Direction 1 Summary (Spec -> Plan)

All specification elements have plan coverage:

| Spec Element | Plan Coverage |
|---|---|
| Target directory `.cursor/skills/` | Task 1-1 TARGET_DIRS |
| Asset types: skills only, Partial Record | Task 1-1 solution + AC |
| Asset routing table (updated) | Task 1-2 spec reference |
| Three-tier detection | Task 1-1 Do steps + AC |
| AgentId union update | Task 1-2 Do + AC |
| KNOWN_AGENTS update | Task 1-2 Do + AC |
| Implementation files (cursor-driver.ts, registry, types, config) | Tasks 1-1 + 1-2 |
| selectAgents filter to declaredAgents | Task 1-3 |
| Undeclared agents excluded entirely | Task 1-3 AC |
| Persistent not-detected hint in label | Task 1-3 Do + AC |
| @clack/prompts label embedding rationale | Task 1-3 Context |
| Collection pipeline per-plugin filtering | Task 2-1 |
| Remove warn-and-install-anyway | Task 2-1 AC |
| Manifest records per-plugin agents | Task 2-1 AC |
| Zero applicable agents silent skip | Task 2-2 |
| Union of declared agents drives selectAgents | Phase 2 AC + Task 2-1 AC |
| Auto-skip: one declared + detected | Task 1-4 |
| Auto-skip: one declared + not detected shows prompt | Task 1-4 |
| Auto-skip: multiple declared always shows prompt | Task 1-4 |
| No version gating constraint | **Finding 1 -- incomplete** |

## Direction 2 Summary (Plan -> Spec)

All plan elements trace back to the specification:

| Plan Element | Spec Trace |
|---|---|
| Task 1-1: CursorDriver class | Cursor Driver + Detection + Asset Types + Target Directory |
| Task 1-2: Type system + registry integration | AgentId Type + Implementation |
| Task 1-2: identify.ts test coverage | Necessary consequence of registry integration (spec: "Register in the driver registry") |
| Task 1-3: Filter selectAgents | Agent Selection: Filter to Declared Agents |
| Task 1-4: Auto-skip logic | Agent Selection: Auto-Skip When Unambiguous |
| Task 2-1: Per-plugin agent filtering | Collection Pipeline: Silent Skip for Undeclared Agents |
| Task 2-1: PluginInstallResult.agents field | Implementation consequence of "manifest entry records only agents actually installed for" |
| Task 2-1: Summary renderer changes | Implementation consequence of per-plugin agent recording |
| Task 2-2: Silent skip for zero-match | Collection Pipeline: "silently skip that plugin" |
| Task 2-2: All-zero-match edge case | Boundary condition of specified silent-skip behavior |

No hallucinated content detected. All implementation details (identify.ts tests, PluginInstallResult changes, summary renderer updates) are necessary consequences of spec requirements, not invented scope.
