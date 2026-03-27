import { isCancel, log, multiselect } from "@clack/prompts";
import type { AgentId } from "./drivers/types.js";

interface SelectAgentsInput {
	declaredAgents: AgentId[];
	detectedAgents: AgentId[];
}

export async function selectAgents(
	input: SelectAgentsInput,
): Promise<AgentId[]> {
	if (input.declaredAgents.length === 0) {
		return [];
	}

	const detectedSet = new Set(input.detectedAgents);

	const singleAgent = input.declaredAgents[0];
	if (
		input.declaredAgents.length === 1 &&
		singleAgent &&
		detectedSet.has(singleAgent)
	) {
		log.info(`Auto-selected agent: ${singleAgent}`);
		return [singleAgent];
	}

	const initialValues = input.declaredAgents.filter((id) =>
		detectedSet.has(id),
	);

	const options = input.declaredAgents.map((id) => ({
		value: id,
		label: detectedSet.has(id) ? id : `${id} (not detected in project)`,
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
