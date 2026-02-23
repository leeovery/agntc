import { access, cp, mkdir, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import type { AgentWithDriver } from "./drivers/types.js";

export interface CopyBareSkillInput {
	sourceDir: string;
	projectDir: string;
	agents: AgentWithDriver[];
}

export interface CopyBareSkillResult {
	copiedFiles: string[];
}

export async function copyBareSkill(
	input: CopyBareSkillInput,
): Promise<CopyBareSkillResult> {
	const { sourceDir, projectDir, agents } = input;
	const skillName = basename(sourceDir);
	const copiedFiles: string[] = [];

	try {
		for (const agent of agents) {
			const targetDir = agent.driver.getTargetDir("skills");
			if (targetDir === null) {
				continue;
			}

			const destDir = join(projectDir, targetDir, skillName);
			await mkdir(destDir, { recursive: true });
			await cp(sourceDir, destDir, { recursive: true });

			await removeIfExists(join(destDir, "agntc.json"));

			const relativePath = relative(projectDir, destDir) + "/";
			copiedFiles.push(relativePath);
		}
	} catch (err) {
		await rollbackCopiedFiles(copiedFiles, projectDir);
		throw err;
	}

	return { copiedFiles };
}

async function removeIfExists(path: string): Promise<void> {
	try {
		await access(path);
		await rm(path);
	} catch {
		// File doesn't exist, nothing to remove
	}
}
