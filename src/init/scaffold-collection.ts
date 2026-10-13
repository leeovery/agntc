import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldPlugin } from "./scaffold-plugin.js";
import type { ScaffoldResult } from "./scaffold-utils.js";

const PREFIX = "my-plugin";

export async function scaffoldCollection(options: {
	targetDir: string;
}): Promise<ScaffoldResult> {
	const pluginDir = join(options.targetDir, PREFIX);
	await mkdir(pluginDir, { recursive: true });

	const result = await scaffoldPlugin({ targetDir: pluginDir });

	const prefix = (path: string) => `${PREFIX}/${path}`;

	return {
		created: result.created.map(prefix),
		skipped: result.skipped.map(prefix),
	};
}
