import { isCancel, log, multiselect } from "@clack/prompts";
import { getRegisteredAgentIds } from "../drivers/registry.js";
import type { AgentId } from "../drivers/types.js";

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function selectInitAgents(): Promise<AgentId[] | null> {
	const agentIds = getRegisteredAgentIds();
	const options = agentIds.map((id) => ({
		value: id,
		label: capitalize(id),
	}));

	while (true) {
		const result = await multiselect<AgentId>({
			message: "Which agents is this built for?",
			options,
			required: false,
		});

		if (isCancel(result)) {
			return null;
		}

		if (result.length === 0) {
			log.warn("At least one agent must be selected");
			continue;
		}

		return result;
	}
}
