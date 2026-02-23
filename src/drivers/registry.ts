import { ClaudeDriver } from "./claude-driver.js";
import { CodexDriver } from "./codex-driver.js";
import type { AgentDriver, AgentId } from "./types.js";

const DRIVER_REGISTRY: Record<AgentId, AgentDriver> = {
	claude: new ClaudeDriver(),
	codex: new CodexDriver(),
};

export function getDriver(id: AgentId): AgentDriver {
	return DRIVER_REGISTRY[id];
}

export function getRegisteredAgentIds(): AgentId[] {
	return Object.keys(DRIVER_REGISTRY) as AgentId[];
}
