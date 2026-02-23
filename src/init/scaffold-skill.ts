import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";

export interface ScaffoldResult {
	created: string[];
	skipped: string[];
	overwritten: string[];
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
	reconfigure?: boolean;
}): Promise<ScaffoldResult> {
	const created: string[] = [];
	const skipped: string[] = [];
	const overwritten: string[] = [];

	const agntcJsonPath = join(options.targetDir, "agntc.json");
	const agntcJsonContent = `${JSON.stringify({ agents: options.agents }, null, 2)}\n`;

	if (await fileExists(agntcJsonPath)) {
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
	if (await fileExists(skillMdPath)) {
		skipped.push("SKILL.md");
	} else {
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("SKILL.md");
	}

	return { created, skipped, overwritten };
}
