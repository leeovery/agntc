import { basename, join } from "node:path";
import { type AssetType, targetDir } from "./asset-targets.js";
import { readDirEntries } from "./fs-utils.js";

interface BareSkillInput {
	type: "bare-skill";
	sourceDir: string;
	/**
	 * Installed skill dir name (identity = repo/unit basename). Must match the
	 * name {@link copyBareSkill} writes to, or collision/unmanaged checks compute
	 * the wrong destination path. Defaults to `basename(sourceDir)` when omitted.
	 */
	skillName?: string;
}

interface PluginInput {
	type: "plugin";
	sourceDir: string;
	assetDirs: AssetType[];
}

export type ComputeInput = BareSkillInput | PluginInput;

/**
 * Predicts the file paths that would be produced by copy operations,
 * without actually copying. Used for collision and unmanaged checks
 * before copy begins.
 */
export async function computeIncomingFiles(
	input: ComputeInput,
): Promise<string[]> {
	if (input.type === "bare-skill") {
		const skillName = input.skillName ?? basename(input.sourceDir);
		return [`${targetDir("skills")}/${skillName}/`];
	}
	return computePluginFiles(input);
}

async function computePluginFiles(input: PluginInput): Promise<string[]> {
	const files: string[] = [];

	for (const assetDir of input.assetDirs) {
		const dir = targetDir(assetDir);
		const entries = await readDirEntries(join(input.sourceDir, assetDir));
		for (const entry of entries) {
			// Skills are directories, agents/hooks are files
			files.push(
				entry.isDirectory ? `${dir}/${entry.name}/` : `${dir}/${entry.name}`,
			);
		}
	}

	return files;
}
