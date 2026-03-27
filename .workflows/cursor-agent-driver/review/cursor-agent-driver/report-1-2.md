TASK: Integrate Cursor into Type System and Registry

ACCEPTANCE CRITERIA:
- AgentId type is "claude" | "codex" | "cursor"
- KNOWN_AGENTS is ["claude", "codex", "cursor"]
- DRIVER_REGISTRY has entries for all three agents
- getDriver("cursor") returns a CursorDriver instance
- getRegisteredAgentIds() returns ["claude", "codex", "cursor"]
- readConfig() accepts "cursor" in agents array
- identifyFileOwnership(".cursor/skills/foo") returns { agentId: "cursor", assetType: "skills" }
- identifyFileOwnership(".cursor/agents/foo") returns null
- All updated tests pass

STATUS: Complete

SPEC CONTEXT: The specification requires adding "cursor" to the AgentId union type and KNOWN_AGENTS array, keeping the explicit union since three members is still small and compile-time exhaustiveness checking is valuable. The driver registry must be updated so that identifyFileOwnership() dynamically picks up cursor paths. The config parser uses KNOWN_AGENTS for validation, so adding "cursor" there is sufficient for config acceptance.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/drivers/types.ts:1 -- AgentId union includes "cursor"
  - src/config.ts:10 -- KNOWN_AGENTS includes "cursor"
  - src/drivers/registry.ts:3,9 -- CursorDriver imported and registered
  - src/drivers/registry.ts:6 -- Record<AgentId, AgentDriver> enforces compile-time exhaustiveness
- Notes: All changes are minimal and consistent with existing patterns. No code change was needed in identify.ts -- it dynamically discovers cursor via the registry. No drift from plan.

TESTS:
- Status: Adequate
- Coverage:
  - registry.test.ts: "returns cursor driver for 'cursor'" (line 23), "lists registered agent IDs including claude, codex, and cursor" (line 29)
  - config.test.ts: "contains claude, codex, and cursor" (line 9), "parses valid config with cursor agent" (line 47), "parses valid config with all three agents" (line 56)
  - identify.test.ts: "identifies .cursor/skills/foo as cursor skills" (line 35), "identifies .cursor/skills/foo/SKILL.md as cursor skills" (line 41), "returns null for .cursor/agents/ path" (line 47)
- Notes: All 8 required tests from the plan are present and correctly verify the acceptance criteria. Tests are focused -- each tests a distinct criterion without redundancy. Existing pre-cursor tests are preserved. Tests would fail if the feature broke (e.g., removing "cursor" from AgentId would cause registry.test.ts and config.test.ts to fail).

CODE QUALITY:
- Project conventions: Followed -- consistent with existing driver registration pattern, TypeScript strict mode usage, and test file organization
- SOLID principles: Good -- open/closed principle demonstrated well (identify.ts needed no changes), compile-time exhaustiveness via Record<AgentId, AgentDriver>
- Complexity: Low -- each change is a single addition to an existing list or mapping
- Modern idioms: Yes -- proper use of union types, as const, Record utility type
- Readability: Good -- self-documenting, consistent three-agent pattern throughout
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
