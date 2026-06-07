import { isCancel, log, multiselect } from "@clack/prompts";
import { KNOWN_AGENTS } from "./config.js";
import type { AgentId } from "./drivers/types.js";

interface SelectAgentsInput {
	declaredAgents: AgentId[];
	detectedAgents: AgentId[];
}

export async function selectAgents(
	input: SelectAgentsInput,
): Promise<AgentId[]> {
	const hasDeclaration = input.declaredAgents.length > 0;
	const candidates: AgentId[] = hasDeclaration
		? input.declaredAgents
		: [...KNOWN_AGENTS];

	const detectedSet = new Set(input.detectedAgents);

	const singleAgent = candidates[0];
	if (
		hasDeclaration &&
		candidates.length === 1 &&
		singleAgent &&
		detectedSet.has(singleAgent)
	) {
		log.info(`Auto-selected agent: ${singleAgent}`);
		return [singleAgent];
	}

	const initialValues = candidates.filter((id) => detectedSet.has(id));

	const options = candidates.map((id) => ({
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
