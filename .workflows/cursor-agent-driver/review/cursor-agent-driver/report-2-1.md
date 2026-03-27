TASK: Per-Plugin Agent Filtering in Collection Pipeline

ACCEPTANCE CRITERIA:
- [x] The warning code is completely removed from runCollectionPipeline
- [x] Each plugin's copy operation receives only the intersection agents
- [x] Each plugin's manifest entry records only its applicable agents
- [x] computeIncomingFiles receives per-plugin filtered agents
- [x] selectAgents call still uses union of all declared agents (preserved)
- [x] renderCollectionAddSummary uses per-plugin agents
- [x] All existing collection pipeline tests pass (updated)

STATUS: Complete

SPEC CONTEXT: The spec section "Collection Pipeline: Silent Skip for Undeclared Agents" requires replacing the warn-and-install-anyway model with per-plugin agent filtering. When iterating plugins in the collection pipeline, filter selectedAgents to only those declared by each specific plugin before copying. No warning, no "at your own risk." The manifest entry for each plugin records only the agents it was actually installed for. The union-based selectAgents call should be preserved.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/commands/add.ts:428-550 (pluginsToInstall with pluginAgents/pluginAgentDrivers fields, per-plugin filtering at line 478-485)
  - src/commands/add.ts:552-601 (copy loop uses per-plugin agents from pluginsToInstall)
  - src/commands/add.ts:604-622 (manifest write uses result.agents, not selectedAgents)
  - src/commands/add.ts:625-633 (renderCollectionAddSummary receives results with per-plugin agents)
  - src/summary.ts:101-109 (PluginInstallResult has agents: AgentId[] field)
  - src/summary.ts:111-116 (CollectionAddSummaryInput no longer has selectedAgents)
  - src/summary.ts:126-131 (renderCollectionAddSummary uses r.agents for formatPluginSummary/formatBareSkillSummary)
- Notes:
  - Warning code ("does not declare support for") is completely absent from src/commands/add.ts
  - Global agents array build removed from collection pipeline; only exists in standalone runAdd at line 229
  - Per-plugin intersection computed at line 479-480 using Set-based filtering
  - Zero-match early continue at line 481 (part of task 2-2 but integrated cleanly here)
  - pluginsToInstall stores both pluginAgents (AgentId[]) and pluginAgentDrivers (AgentWithDriver[]) per plugin

TESTS:
- Status: Adequate
- Coverage:
  - "filters selectedAgents to plugin's declared agents before copy -- pluginA (claude-only) receives only claude driver" (line 1261)
  - "filters selectedAgents to plugin's declared agents before copy -- pluginB (codex-only) receives only codex driver" (line 1275)
  - "manifest entry for each plugin records only its applicable agents" (line 1289)
  - "no 'does not declare support' warnings are logged" (line 1310)
  - "plugin declaring exact same agents as selected receives all agents (no-op filter)" (line 1322)
  - "all plugins declaring identical agents behaves like unfiltered code" (line 1366)
  - "computeIncomingFiles receives per-plugin filtered agents" (line 1405)
  - "selectAgents still called with union of all declared agents across plugins" (line 1426)
  - All 8 planned tests present and assertions are specific
- Notes:
  - Tests cover both the divergent-agents case (pluginA=claude, pluginB=codex) and the identical-agents case
  - Manifest assertion test checks per-plugin agents for both pluginA and pluginB independently
  - Warning absence test scans all warn calls for the old message pattern
  - computeIncomingFiles test verifies the agents passed to compute, not just copy -- ensuring conflict checks use correct agents
  - Tests are focused and not redundant; each verifies a distinct aspect of the filtering behavior

CODE QUALITY:
- Project conventions: Followed -- TypeScript strict types, consistent with existing codebase patterns
- SOLID principles: Good -- per-plugin filtering is a clean intersection computation, no new abstractions needed
- Complexity: Low -- Set-based filter + map is straightforward; no nested conditionals added
- Modern idioms: Yes -- uses Set for O(1) lookup, Array.filter for intersection, destructured loop variables
- Readability: Good -- comment at line 478 clearly labels the filtering step; variable names (pluginAgents, pluginAgentDrivers, declaredSet) are self-documenting
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
