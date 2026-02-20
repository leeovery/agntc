import type { AgentDriver, AgentId } from "./types.js";
import { ClaudeDriver } from "./claude-driver.js";
import { CodexDriver } from "./codex-driver.js";

const DRIVER_REGISTRY: Record<string, AgentDriver> = {
  claude: new ClaudeDriver(),
  codex: new CodexDriver(),
};

export function getDriver(id: AgentId): AgentDriver {
  const driver = DRIVER_REGISTRY[id];
  if (!driver) {
    throw new Error(`No driver registered for agent: ${id}`);
  }
  return driver;
}

export function getRegisteredAgentIds(): AgentId[] {
  return Object.keys(DRIVER_REGISTRY) as AgentId[];
}
