import { basename, join } from "node:path";
import type { AgentWithDriver, AssetType } from "./drivers/types.js";
import { type DirEntry, readDirEntries } from "./fs-utils.js";

interface BareSkillInput {
	type: "bare-skill";
	sourceDir: string;
	agents: AgentWithDriver[];
}

interface PluginInput {
	type: "plugin";
	sourceDir: string;
	assetDirs: AssetType[];
	agents: AgentWithDriver[];
}

type ComputeInput = BareSkillInput | PluginInput;

/**
 * Predicts the file paths that would be produced by copy operations,
 * without actually copying. Used for collision and unmanaged checks
 * before copy begins.
 */
export async function computeIncomingFiles(
	input: ComputeInput,
): Promise<string[]> {
	if (input.type === "bare-skill") {
		return computeBareSkillFiles(input);
	}
	return computePluginFiles(input);
}

function computeBareSkillFiles(input: BareSkillInput): string[] {
	const skillName = basename(input.sourceDir);
	const files: string[] = [];

	for (const agent of input.agents) {
		const targetDir = agent.driver.getTargetDir("skills");
		if (targetDir === null) {
			continue;
		}
		files.push(`${targetDir}/${skillName}/`);
	}

	return files;
}

async function computePluginFiles(input: PluginInput): Promise<string[]> {
	const { sourceDir, assetDirs, agents } = input;
	const seen = new Set<string>();
	const files: string[] = [];

	// Scan source asset directories to enumerate individual assets
	const assetEntries = new Map<AssetType, DirEntry[]>();
	for (const assetDir of assetDirs) {
		assetEntries.set(assetDir, await readDirEntries(join(sourceDir, assetDir)));
	}

	for (const agent of agents) {
		for (const assetDir of assetDirs) {
			const targetDir = agent.driver.getTargetDir(assetDir);
			if (targetDir === null) {
				continue;
			}

			const entries = assetEntries.get(assetDir) ?? [];
			for (const entry of entries) {
				// Skills are directories, agents/hooks are files
				const path = entry.isDirectory
					? `${targetDir}/${entry.name}/`
					: `${targetDir}/${entry.name}`;

				if (!seen.has(path)) {
					seen.add(path);
					files.push(path);
				}
			}
		}
	}

	return files;
}
