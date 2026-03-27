---
status: clean
created: 2026-03-27
cycle: 2
phase: Traceability Review
topic: Cursor Agent Driver
---

# Review Tracking: Cursor Agent Driver - Traceability

## Findings

No findings. The plan is a faithful, complete translation of the specification.

## Cycle 1 Fix Verification

The single finding from cycle 1 ("Missing 'no version gating' constraint from spec") has been correctly applied. Task 1-1's Context section now contains:

> agntc does not gate on Cursor version -- the driver has no version checking logic. Skills won't function on Cursor versions below 2.4, but that is not agntc's concern.

This matches the proposed fix exactly.

## Direction 1 Summary (Spec -> Plan)

All specification elements have plan coverage:

| Spec Element | Plan Coverage |
|---|---|
| Cursor 2.4+ reads SKILL.md natively, no format conversion | Task 1-1 Context |
| No version gating constraint | Task 1-1 Context (cycle 1 fix applied) |
| Target directory `.cursor/skills/` | Task 1-1 TARGET_DIRS |
| First-class Cursor skill directory | Task 1-1 Context |
| Asset types: skills only, Partial Record | Task 1-1 Solution + AC |
| Asset routing table (updated with cursor column) | Task 1-2 spec reference |
| getTargetDir returns null for unsupported types | Task 1-1 AC |
| Three-tier detection matching Claude driver pattern | Task 1-1 Do steps + Context |
| Detection tier 1: .cursor/ project dir | Task 1-1 Do step 3.1 |
| Detection tier 2: which cursor CLI | Task 1-1 Do step 3.2 |
| Detection tier 3: ~/.cursor/ home fallback | Task 1-1 Do step 3.3 |
| AgentId union: "claude" \| "codex" \| "cursor" | Task 1-2 Do + AC |
| KNOWN_AGENTS includes "cursor" | Task 1-2 Do + AC |
| Keep explicit union, compile-time exhaustiveness | Task 1-2 Context |
| New file src/drivers/cursor-driver.ts | Task 1-1 Do |
| Register in src/drivers/registry.ts | Task 1-2 Do |
| Update AgentId in src/drivers/types.ts | Task 1-2 Do |
| Update KNOWN_AGENTS in src/config.ts | Task 1-2 Do |
| selectAgents filters to declaredAgents only | Task 1-3 Do + AC |
| Undeclared agents excluded entirely | Task 1-3 AC |
| Persistent "(not detected in project)" hint in label | Task 1-3 Do + AC |
| Embed hint in label not hint property (@clack reason) | Task 1-3 Do + Context |
| Modify selectAgents in src/agent-select.ts | Tasks 1-3 + 1-4 |
| Rationale: plugin authors declare agents intentionally | Task 1-3 Context |
| Collection pipeline: filter selectedAgents per plugin | Task 2-1 |
| No warning, no "at your own risk" | Task 2-1 AC |
| Manifest records only agents actually installed for | Task 2-1 AC |
| Zero applicable agents: silently skip | Task 2-2 |
| No manifest entry, no copy, no summary line | Task 2-2 AC |
| Expected when collection has plugins targeting different agents | Task 2-2 Context |
| Warning-and-install-anyway model is wrong | Task 2-1 Problem + Context |
| Union of declared agents drives selectAgents | Task 2-1 AC + Phase 2 AC |
| Modify collection pipeline in src/commands/add.ts | Task 2-1 Do |
| Auto-skip: one declared + detected -> auto-select, skip, log | Task 1-4 AC |
| Auto-skip: one declared + not detected -> show prompt | Task 1-4 AC |
| Auto-skip: multiple declared -> always show prompt | Task 1-4 AC |
| Auto-skip rationale: only when completely unambiguous | Task 1-4 Context |
| Not-detected edge case warrants user confirmation | Task 1-4 Edge Cases + Context |

## Direction 2 Summary (Plan -> Spec)

All plan elements trace back to the specification:

| Plan Element | Spec Trace |
|---|---|
| Task 1-1: CursorDriver class | Cursor Driver + Detection + Asset Types + Target Directory |
| Task 1-1: Early-return short-circuiting | Implementation detail of three-tier pattern matching Claude driver |
| Task 1-1: Private method naming | Implementation guidance, not new scope |
| Task 1-2: Type system + registry integration | AgentId Type + Implementation |
| Task 1-2: identify.ts test coverage | Necessary consequence of "Register in the driver registry" |
| Task 1-2: readConfig accepts "cursor" | Necessary consequence of KNOWN_AGENTS update |
| Task 1-3: Filter selectAgents | Agent Selection: Filter to Declared Agents |
| Task 1-3: Empty declaredAgents edge case | Boundary condition of declared-only filtering |
| Task 1-4: Auto-skip logic | Agent Selection: Auto-Skip When Unambiguous |
| Task 1-4: Zero declared agents edge case | Boundary condition of auto-skip rules |
| Task 2-1: Per-plugin agent filtering | Collection Pipeline: Silent Skip for Undeclared Agents |
| Task 2-1: PluginInstallResult.agents field | Consequence of "manifest records only agents actually installed for" |
| Task 2-1: Summary renderer changes | Consequence of per-plugin agent recording |
| Task 2-2: Silent skip for zero-match | "silently skip that plugin" |
| Task 2-2: Distinction from existing "skipped" status | Enforces spec's "no summary line" requirement |
| Task 2-2: All-zero-match and single-plugin edge cases | Boundary conditions of specified silent-skip behavior |

No hallucinated content detected. All implementation details are necessary consequences of spec requirements, not invented scope.
