import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists, type ScaffoldResult } from "./scaffold-utils.js";
import { SKILL_MD_TEMPLATE } from "./templates.js";

export type { ScaffoldResult } from "./scaffold-utils.js";

export async function scaffoldSkill(options: {
	targetDir: string;
}): Promise<ScaffoldResult> {
	const created: string[] = [];
	const skipped: string[] = [];

	const skillMdPath = join(options.targetDir, "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("SKILL.md");
	} else {
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("SKILL.md");
	}

	return { created, skipped };
}
