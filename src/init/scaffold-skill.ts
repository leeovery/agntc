import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";

export interface ScaffoldResult {
	created: string[];
	skipped: string[];
}

const SKILL_MD_TEMPLATE = `---
name: my-skill
description: Brief description of what this skill does and when to use it.
---

# My Skill

## Instructions

[Describe what the agent should do when this skill is invoked]
`;

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function scaffoldSkill(options: {
	agents: AgentId[];
	targetDir: string;
}): Promise<ScaffoldResult> {
	const created: string[] = [];
	const skipped: string[] = [];

	const agntcJsonPath = join(options.targetDir, "agntc.json");
	if (await fileExists(agntcJsonPath)) {
		skipped.push("agntc.json");
	} else {
		const content = `${JSON.stringify({ agents: options.agents }, null, 2)}\n`;
		await writeFile(agntcJsonPath, content, "utf-8");
		created.push("agntc.json");
	}

	const skillMdPath = join(options.targetDir, "SKILL.md");
	if (await fileExists(skillMdPath)) {
		skipped.push("SKILL.md");
	} else {
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("SKILL.md");
	}

	return { created, skipped };
}
