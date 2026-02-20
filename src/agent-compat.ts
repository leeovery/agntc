import type { AgentId } from "./drivers/types.js";

export interface AgentChanges {
  effective: AgentId[];
  dropped: AgentId[];
}

export function computeAgentChanges(
  entryAgents: AgentId[],
  newConfigAgents: AgentId[],
): AgentChanges {
  const newSet = new Set(newConfigAgents);
  const effective = entryAgents.filter((a) => newSet.has(a));
  const dropped = entryAgents.filter((a) => !effective.includes(a));
  return { effective, dropped };
}
