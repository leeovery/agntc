import type { AgentId } from "./drivers/types.js";

export function computeEffectiveAgents(
  entryAgents: AgentId[],
  newConfigAgents: AgentId[],
): AgentId[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => newSet.has(a));
}

export function findDroppedAgents(
  entryAgents: AgentId[],
  newConfigAgents: AgentId[],
): AgentId[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => !newSet.has(a));
}
