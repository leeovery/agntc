AGENT: architecture
FINDINGS:
- FINDING: KNOWN_AGENTS and AgentId are independently maintained — no compile-time link
  SEVERITY: medium
  FILES: src/config.ts:10, src/drivers/types.ts:1
  DESCRIPTION: `AgentId` is a hand-written union (`"claude" | "codex" | "cursor"`) and `KNOWN_AGENTS` is a separate `as const` array (`["claude", "codex", "cursor"]`). Neither is derived from the other. If a fourth agent is added to one but not the other, `readConfig` will silently filter out the new agent (or accept an unknown string as `AgentId`). The same risk exists between `KNOWN_AGENTS` / `AgentId` and the `DRIVER_REGISTRY` keys in `registry.ts` — three independent lists that must stay in sync by caller discipline.
  RECOMMENDATION: Derive `AgentId` from `KNOWN_AGENTS`: move the const array to `types.ts` (or a shared location), then `type AgentId = (typeof KNOWN_AGENTS)[number]`. This makes the union automatically match the array. The registry already uses `Record<AgentId, AgentDriver>`, so TypeScript will enforce that every AgentId has a driver entry. One source of truth, two consumers.
SUMMARY: Single medium-severity finding: the AgentId union, KNOWN_AGENTS array, and driver registry keys are three independent declarations of the same set, creating a latent sync risk. Otherwise the architecture is sound — the cursor driver follows existing patterns, agent-select filtering is clean, and collection pipeline seams are well-tested.
