import { isCancel, log, multiselect } from "@clack/prompts";
import { getRegisteredAgentIds } from "./drivers/registry.js";
import type { AgentId } from "./drivers/types.js";

interface SelectAgentsInput {
	declaredAgents: AgentId[];
	detectedAgents: AgentId[];
}

export async function selectAgents(
	input: SelectAgentsInput,
): Promise<AgentId[]> {
	const allAgents = getRegisteredAgentIds();
	const declaredSet = new Set(input.declaredAgents);
	const detectedSet = new Set(input.detectedAgents);

	const initialValues = allAgents.filter(
		(id) => declaredSet.has(id) && detectedSet.has(id),
	);

	const options = allAgents.map((id) => ({
		value: id,
		label: id,
		...(declaredSet.has(id) ? {} : { hint: "not declared by plugin" }),
	}));

	const result = await multiselect<AgentId>({
		message: "Select agents to install for",
		options,
		initialValues,
		required: false,
	});

	if (isCancel(result)) {
		return [];
	}

	if (result.length === 0) {
		log.info("No agents selected — skipping");
		return [];
	}

	return result;
}
