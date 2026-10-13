import { basename, join } from "node:path";
import { skillTarget } from "./asset-targets.js";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import { type CopySource, planCopy, writeCopy } from "./copy-safety.js";
import { assertNoLinkInTheWay, isSafeSegment } from "./install-paths.js";

export interface CopyBareSkillInput {
	sourceDir: string;
	/** What the skill comes from, which decides what its links install as. */
	source: CopySource;
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
	const { sourceDir, source, projectDir } = input;
	const skillName = input.skillName ?? basename(sourceDir);
	// A hand-edited manifest key names the skill, so it could be `..`.
	if (!isSafeSegment(skillName)) {
		throw new Error(`"${skillName}" can't be a skill's folder name`);
	}
	const installedDir = skillTarget(skillName);
	const steps = await planCopy(sourceDir, source, isSkillContent);

	// Outside the try: a link in the way isn't the copy's to roll back.
	await assertNoLinkInTheWay(projectDir, installedDir);
	try {
		await writeCopy(steps, join(projectDir, installedDir));
	} catch (err) {
		await rollbackCopiedFiles([installedDir], projectDir);
		throw err;
	}

	return { copiedFiles: [installedDir] };
}

/**
 * A skill installs without `.git` at any depth, which for a skill at the repo
 * root is the whole clone's history, or its top-level `agntc.json`.
 */
function isSkillContent(path: string): boolean {
	return path !== "agntc.json" && !path.split("/").includes(".git");
}
