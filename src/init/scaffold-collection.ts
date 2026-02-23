import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import { scaffoldPlugin } from "./scaffold-plugin.js";
import type { ScaffoldResult } from "./scaffold-utils.js";

const PREFIX = "my-plugin";

export async function scaffoldCollection(options: {
	agents: AgentId[];
	targetDir: string;
	reconfigure?: boolean;
}): Promise<ScaffoldResult> {
	const { agents, targetDir, reconfigure } = options;
	const pluginDir = join(targetDir, PREFIX);
	await mkdir(pluginDir, { recursive: true });

	const result = await scaffoldPlugin({
		agents,
		targetDir: pluginDir,
		reconfigure,
	});

	const prefix = (path: string) => `${PREFIX}/${path}`;

	return {
		created: result.created.map(prefix),
		skipped: result.skipped.map(prefix),
		overwritten: result.overwritten.map(prefix),
	};
}
