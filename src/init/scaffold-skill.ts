import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import { pathExists, type ScaffoldResult } from "./scaffold-utils.js";
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

	const agntcJsonPath = join(options.targetDir, "agntc.json");
	const agntcJsonContent = `${JSON.stringify({ agents: options.agents }, null, 2)}\n`;

	if (await pathExists(agntcJsonPath)) {
		if (options.reconfigure) {
			await writeFile(agntcJsonPath, agntcJsonContent, "utf-8");
			overwritten.push("agntc.json");
		} else {
			skipped.push("agntc.json");
		}
	} else {
		await writeFile(agntcJsonPath, agntcJsonContent, "utf-8");
		created.push("agntc.json");
	}

	const skillMdPath = join(options.targetDir, "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("SKILL.md");
	} else {
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("SKILL.md");
	}

	return { created, skipped, overwritten };
}
