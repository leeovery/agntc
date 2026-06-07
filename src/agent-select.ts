import { isCancel, log, multiselect } from "@clack/prompts";
import { KNOWN_AGENTS } from "./config.js";
import type { AgentId } from "./drivers/types.js";

interface SelectAgentsInput {
	declaredAgents: AgentId[];
	detectedAgents: AgentId[];
}

/**
 * Outcome of agent selection. `cancelled` means the installer aborted the
 * prompt (Esc); `selected` carries the chosen agents — which may be empty when
 * the installer deliberately ticked nothing. Callers map these distinct cases
 * to their own channel (standalone cancel/abort vs. collection per-member skip),
 * so the empty-selection and cancellation paths no longer collapse to one value.
 */
export type SelectAgentsResult =
	| { kind: "cancelled" }
	| { kind: "selected"; agents: AgentId[] };

export async function selectAgents(
	input: SelectAgentsInput,
): Promise<SelectAgentsResult> {
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
		return { kind: "selected", agents: [singleAgent] };
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
		return { kind: "cancelled" };
	}

	// A zero-length selection is a deliberate choice (the installer actively
	// ticked nothing), distinct from cancellation. Messaging for the empty case
	// lives in the caller: the standalone path emits a single coherent abort, the
	// collection path stays silent (spec-mandated per-member skip).
	return { kind: "selected", agents: result };
}
