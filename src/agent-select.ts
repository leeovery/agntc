import { isCancel, log, multiselect } from "@clack/prompts";
import { KNOWN_AGENTS } from "./config.js";
import type { AgentId } from "./drivers/types.js";

interface SelectAgentsInput {
	declaredAgents: AgentId[];
	detectedAgents: AgentId[];
	/**
	 * What's being installed, e.g. `the refero-design skill`, `the foo plugin`, or
	 * `these 3 skills`. The prompt is built as
	 * `Install ${unitLabel} for which agent(s)?`, with the agent noun pluralised by
	 * how many options are shown. Omitted → a generic fallback heading.
	 */
	unitLabel?: string;
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

	// Pluralise the agent noun by how many options are actually shown (a single
	// detected declared agent auto-selects above, so this is usually plural).
	const noun = candidates.length === 1 ? "agent" : "agents";
	const message = input.unitLabel
		? `Install ${input.unitLabel} for which ${noun}?`
		: "Select agents to install for";

	const result = await multiselect<AgentId>({
		message,
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
