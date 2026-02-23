import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import { scaffoldPlugin } from "./scaffold-plugin.js";
import type { ScaffoldResult } from "./scaffold-utils.js";

const PREFIX = "my-plugin";

export async function scaffoldCollection(
	dir: string,
	agents: AgentId[],
	options?: { reconfigure?: boolean },
): Promise<ScaffoldResult> {
	const pluginDir = join(dir, PREFIX);
	await mkdir(pluginDir, { recursive: true });

	const result = await scaffoldPlugin(pluginDir, agents, options);

	const prefix = (path: string) => `${PREFIX}/${path}`;

	return {
		created: result.created.map(prefix),
		skipped: result.skipped.map(prefix),
		overwritten: result.overwritten.map(prefix),
	};
}
