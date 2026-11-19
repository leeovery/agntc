# Review: configless-install-analysis-10-1

**Task:** Treat empty re-cloned agents array as lenient default in update's resolveAgents
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Specification "Agent Selection / No valid constraint — unified across three cases" (lines 282-290) lists three cases falling back to the lenient default: config absent, config present but agents: [] (empty), config malformed. "An invalid/unusable agents declaration carries no usable author intent, so it is treated identically to no config at all." This mandates the empty-array case be lenient.

## Implementation — Implemented
- src/nuke-reinstall-pipeline.ts:270 — guard `if (configAgents === undefined || configAgents.length === 0)`; doc comment 257-265; call site :135 `resolveAgents(existingEntry.agents, config?.agents)`.
- Guard now covers both undefined and defined-but-empty array, returning recorded agents unchanged, no drops.
- Legitimate no-agents skip preserved: a non-empty configAgents still flows to computeAgentChanges (274); empty intersection still returns { status: "no-agents" } (276). The no-agents path returns at :137 before nukeManifestFiles → skip still avoids destroying install.
- Consistency with add: src/commands/add.ts:355 uses config?.agents ?? [] → [] falls through to KNOWN_AGENTS default; add already lenient.

## Tests — Adequate (all five ACs covered)
- Unit resolveAgents(["claude","codex"], []) → ok/recorded/no drops (tests/nuke-reinstall-pipeline.test.ts:839-846).
- Unit resolveAgents(..., undefined) → same (848-855).
- Unit non-empty intersection narrows (857-864).
- Unit disjoint resolveAgents(["claude"], ["codex"]) → no-agents (866-869).
- Pipeline re-cloned { agents: [], type: "plugin" } → success, agents preserved, droppedAgents [], copyPluginAssets called (486-507).
- Pipeline empty-agents does not invoke onAgentsDropped (509-528).
- Regression "all agents dropped" (559-575): valid non-empty disjoint config STILL yields no-agents AND skips (nuke/copy not called).

## Code Quality
Tabs, named exports, AgentResolution discriminated union; single-responsibility pure function; minimal guard extension; doc comment distinguishes lenient empty/undefined from genuine no-agents failure. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
None.
