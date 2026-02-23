import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import { pathExists, type ScaffoldResult } from "./scaffold-utils.js";
import { SKILL_MD_TEMPLATE } from "./templates.js";

export async function scaffoldPlugin(
	dir: string,
	agents: AgentId[],
	options?: { reconfigure?: boolean },
): Promise<ScaffoldResult> {
	const created: string[] = [];
	const skipped: string[] = [];
	const overwritten: string[] = [];

	const agntcJsonPath = join(dir, "agntc.json");
	const agntcJsonContent = `${JSON.stringify({ agents }, null, 2)}\n`;

	if (await pathExists(agntcJsonPath)) {
		if (options?.reconfigure) {
			await writeFile(agntcJsonPath, agntcJsonContent, "utf-8");
			overwritten.push("agntc.json");
		} else {
			skipped.push("agntc.json");
		}
	} else {
		await writeFile(agntcJsonPath, agntcJsonContent, "utf-8");
		created.push("agntc.json");
	}

	const skillMdPath = join(dir, "skills", "my-skill", "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("skills/my-skill/SKILL.md");
	} else {
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("skills/my-skill/SKILL.md");
	}

	const agentsDir = join(dir, "agents");
	if (await pathExists(agentsDir)) {
		skipped.push("agents/");
	} else {
		await mkdir(agentsDir, { recursive: true });
		created.push("agents/");
	}

	const hooksDir = join(dir, "hooks");
	if (await pathExists(hooksDir)) {
		skipped.push("hooks/");
	} else {
		await mkdir(hooksDir, { recursive: true });
		created.push("hooks/");
	}

	return { created, skipped, overwritten };
}
