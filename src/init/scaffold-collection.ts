import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "../drivers/types.js";

export interface ScaffoldCollectionResult {
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

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function scaffoldCollection(
	dir: string,
	agents: AgentId[],
): Promise<ScaffoldCollectionResult> {
	const created: string[] = [];
	const skipped: string[] = [];
	const pluginDir = join(dir, "my-plugin");

	await mkdir(pluginDir, { recursive: true });

	const agntcJsonPath = join(pluginDir, "agntc.json");
	if (await pathExists(agntcJsonPath)) {
		skipped.push("my-plugin/agntc.json");
	} else {
		const content = `${JSON.stringify({ agents }, null, 2)}\n`;
		await writeFile(agntcJsonPath, content, "utf-8");
		created.push("my-plugin/agntc.json");
	}

	const skillMdPath = join(pluginDir, "skills", "my-skill", "SKILL.md");
	if (await pathExists(skillMdPath)) {
		skipped.push("my-plugin/skills/my-skill/SKILL.md");
	} else {
		await mkdir(join(pluginDir, "skills", "my-skill"), { recursive: true });
		await writeFile(skillMdPath, SKILL_MD_TEMPLATE, "utf-8");
		created.push("my-plugin/skills/my-skill/SKILL.md");
	}

	const agentsDir = join(pluginDir, "agents");
	if (await pathExists(agentsDir)) {
		skipped.push("my-plugin/agents/");
	} else {
		await mkdir(agentsDir, { recursive: true });
		created.push("my-plugin/agents/");
	}

	const hooksDir = join(pluginDir, "hooks");
	if (await pathExists(hooksDir)) {
		skipped.push("my-plugin/hooks/");
	} else {
		await mkdir(hooksDir, { recursive: true });
		created.push("my-plugin/hooks/");
	}

	return { created, skipped };
}
