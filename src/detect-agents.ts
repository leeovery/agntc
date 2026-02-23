import { getDriver, getRegisteredAgentIds } from "./drivers/registry.js";
import type { AgentId } from "./drivers/types.js";

export async function detectAgents(projectDir: string): Promise<AgentId[]> {
	const registeredIds = getRegisteredAgentIds();

	const results = await Promise.all(
		registeredIds.map(async (id) => {
			try {
				const driver = getDriver(id);
				const detected = await driver.detect(projectDir);
				return detected ? id : null;
			} catch {
				return null;
			}
		}),
	);

	return results.filter((id): id is AgentId => id !== null);
}
