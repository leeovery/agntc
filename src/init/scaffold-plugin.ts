import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";
import {
	pathExists,
	type ScaffoldResult,
	writeConfigFile,
} from "./scaffold-utils.js";
import { SKILL_MD_TEMPLATE } from "./templates.js";

export async function scaffoldPlugin(options: {
	agents: AgentId[];
	targetDir: string;
	reconfigure?: boolean;
}): Promise<ScaffoldResult> {
	const { agents, targetDir, reconfigure } = options;
	const created: string[] = [];
	const skipped: string[] = [];
	const overwritten: string[] = [];

	const configResult = await writeConfigFile(targetDir, agents, reconfigure);
	if (configResult.status === "created") created.push(configResult.path);
	else if (configResult.status === "skipped") skipped.push(configResult.path);
	else overwritten.push(configResult.path);

	const skillMdPath = join(targetDir, "skills", "my-skill", "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("skills/my-skill/SKILL.md");
	} else {
		await mkdir(join(targetDir, "skills", "my-skill"), { recursive: true });
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("skills/my-skill/SKILL.md");
	}

	const agentsDir = join(targetDir, "agents");
	if (await pathExists(agentsDir)) {
		skipped.push("agents/");
	} else {
		await mkdir(agentsDir, { recursive: true });
		created.push("agents/");
	}

	const hooksDir = join(targetDir, "hooks");
	if (await pathExists(hooksDir)) {
		skipped.push("hooks/");
	} else {
		await mkdir(hooksDir, { recursive: true });
		created.push("hooks/");
	}

	return { created, skipped, overwritten };
}
