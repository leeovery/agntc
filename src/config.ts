import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "./drivers/types.js";
import { errorMessage, isNodeError } from "./errors.js";

export interface AgntcConfig {
	agents: AgentId[];
	type?: string;
}

export const KNOWN_AGENTS = ["claude", "codex", "cursor"] as const;

export interface ReadConfigOptions {
	onWarn?: (message: string) => void;
}

export async function readConfig(
	dir: string,
	options?: ReadConfigOptions,
): Promise<AgntcConfig | null> {
	const filePath = join(dir, "agntc.json");

	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return null;
		}
		throw err;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		options?.onWarn?.(`Ignoring malformed agntc.json: ${errorMessage(err)}`);
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}

	const { agents, type } = parsed as { agents?: unknown; type?: unknown };

	const filtered = filterKnownAgents(agents, options);
	const rawType = typeof type === "string" ? type : undefined;

	if (filtered.length > 0) {
		return {
			agents: filtered,
			...(rawType !== undefined ? { type: rawType } : {}),
		};
	}

	if (rawType !== undefined) {
		return { agents: [], type: rawType };
	}

	return null;
}

function filterKnownAgents(
	agents: unknown,
	options?: ReadConfigOptions,
): AgentId[] {
	if (!Array.isArray(agents)) {
		return [];
	}

	const knownSet = new Set<string>(KNOWN_AGENTS);
	const filtered: AgentId[] = [];

	for (const agent of agents) {
		if (typeof agent === "string" && knownSet.has(agent)) {
			filtered.push(agent as AgentId);
		} else if (typeof agent === "string") {
			options?.onWarn?.(`Unknown agent "${agent}" — skipping`);
		}
	}

	return filtered;
}
