import { access, cp, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { skillTarget } from "./asset-targets.js";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import { assertNoLinkInTheWay } from "./install-paths.js";

export interface CopyBareSkillInput {
	sourceDir: string;
	projectDir: string;
	/**
	 * The installed skill's directory name. Required for a skill at the repo
	 * root, where `sourceDir` is the random `mkdtemp` clone dir and
	 * `basename(sourceDir)` would name the install after the temp dir.
	 */
	skillName?: string;
}

export interface CopyBareSkillResult {
	copiedFiles: string[];
}

export async function copyBareSkill(
	input: CopyBareSkillInput,
): Promise<CopyBareSkillResult> {
	const { sourceDir, projectDir } = input;
	const skillName = input.skillName ?? basename(sourceDir);
	const installedDir = skillTarget(skillName);
	const destDir = join(projectDir, installedDir);

	// Outside the try: a link in the way isn't the copy's to roll back.
	await assertNoLinkInTheWay(projectDir, installedDir);
	try {
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
	} catch (err) {
		await rollbackCopiedFiles([installedDir], projectDir);
		throw err;
	}

	return { copiedFiles: [installedDir] };
}

async function removeIfExists(path: string): Promise<void> {
	try {
		await access(path);
		await rm(path);
	} catch {
		// File doesn't exist, nothing to remove
	}
}
