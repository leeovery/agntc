import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";

export interface ScaffoldResult {
	created: string[];
	skipped: string[];
	overwritten: string[];
}

export interface ConfigFileResult {
	path: string;
	status: "created" | "skipped" | "overwritten";
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function writeConfigFile(
	targetDir: string,
	agents: AgentId[],
	reconfigure?: boolean,
): Promise<ConfigFileResult> {
	const filePath = join(targetDir, "agntc.json");
	const content = `${JSON.stringify({ agents }, null, 2)}\n`;

	if (await pathExists(filePath)) {
		if (reconfigure) {
			await writeFile(filePath, content, "utf-8");
			return { path: "agntc.json", status: "overwritten" };
		}
		return { path: "agntc.json", status: "skipped" };
	}

	await writeFile(filePath, content, "utf-8");
	return { path: "agntc.json", status: "created" };
}
