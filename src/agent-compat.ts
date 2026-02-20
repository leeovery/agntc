export function computeEffectiveAgents(
  entryAgents: string[],
  newConfigAgents: string[],
): string[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => newSet.has(a));
}

export function findDroppedAgents(
  entryAgents: string[],
  newConfigAgents: string[],
): string[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => !newSet.has(a));
}
