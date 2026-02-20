import type { AgentId, AssetType } from "./types.js";
import { getDriver, getRegisteredAgentIds } from "./registry.js";

export interface FileOwnership {
  agentId: AgentId;
  assetType: AssetType;
}

const ASSET_TYPES: AssetType[] = ["skills", "agents", "hooks"];

export function identifyFileOwnership(filePath: string): FileOwnership | null {
  for (const agentId of getRegisteredAgentIds()) {
    const driver = getDriver(agentId);
    for (const assetType of ASSET_TYPES) {
      const targetDir = driver.getTargetDir(assetType);
      if (targetDir !== null && filePath.startsWith(targetDir)) {
        return { agentId, assetType };
      }
    }
  }
  return null;
}
