import { access, cp, mkdir, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import type { AgentWithDriver } from "./drivers/types.js";

export interface CopyBareSkillInput {
	sourceDir: string;
	projectDir: string;
	agents: AgentWithDriver[];
	/**
	 * The installed skill's directory name (identity = repo/unit basename per
	 * spec). Required for a whole-repo bare skill, where `sourceDir` is the random
	 * `mkdtemp` clone dir and `basename(sourceDir)` would name the install after
	 * the temp dir. Defaults to `basename(sourceDir)` for callers whose source dir
	 * already IS the unit dir (collection members, tree-path selectors).
	 */
	skillName?: string;
}

export interface CopyBareSkillResult {
	copiedFiles: string[];
}

export async function copyBareSkill(
	input: CopyBareSkillInput,
): Promise<CopyBareSkillResult> {
	const { sourceDir, projectDir, agents } = input;
	const skillName = input.skillName ?? basename(sourceDir);
	const copiedFiles: string[] = [];

	try {
		for (const agent of agents) {
			const targetDir = agent.driver.getTargetDir("skills");
			if (targetDir === null) {
				continue;
			}

			const destDir = join(projectDir, targetDir, skillName);
			await mkdir(destDir, { recursive: true });
			// Exclude `.git` — for a whole-repo bare skill `sourceDir` is the clone
			// root, so an unfiltered recursive copy would drop the entire git repo
			// into the installed skill. The filter prunes the `.git` subtree (any
			// nested `.git` too); all other author content is kept (spec: keep
			// everything). `agntc.json` is stripped post-copy below.
			await cp(sourceDir, destDir, {
				recursive: true,
				filter: (src) => basename(src) !== ".git",
			});

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
