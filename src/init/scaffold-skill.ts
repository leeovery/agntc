import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import {
	pathExists,
	type ScaffoldResult,
	writeConfigFile,
} from "./scaffold-utils.js";
import { SKILL_MD_TEMPLATE } from "./templates.js";

export type { ScaffoldResult } from "./scaffold-utils.js";

export async function scaffoldSkill(options: {
	agents: AgentId[];
	targetDir: string;
	reconfigure?: boolean;
}): Promise<ScaffoldResult> {
	const created: string[] = [];
	const skipped: string[] = [];
	const overwritten: string[] = [];

	const configResult = await writeConfigFile(
		options.targetDir,
		options.agents,
		options.reconfigure,
	);
	if (configResult.status === "created") created.push(configResult.path);
	else if (configResult.status === "skipped") skipped.push(configResult.path);
	else overwritten.push(configResult.path);

	const skillMdPath = join(options.targetDir, "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("SKILL.md");
	} else {
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("SKILL.md");
	}

	return { created, skipped, overwritten };
}
