import { join } from "node:path";
import { skillTarget } from "./asset-targets.js";
import { agentTarget, hookTarget, listAgentFiles } from "./copy-pack.js";
import type { FoundPack } from "./discover.js";
import { readDirEntries } from "./fs-utils.js";
import type { InstallItem } from "./install-item.js";

/**
 * Predicts the install paths copying an item would claim, without copying, so
 * collision and unmanaged checks can run before anything is written. `root` is
 * the source root the item's paths are relative to.
 */
export async function computeIncomingFiles(
	item: InstallItem,
	root: string,
): Promise<string[]> {
	if (item.kind === "skill") {
		return [skillTarget(item.skill.name)];
	}
	return computePackFiles(item.pack, root);
}

async function computePackFiles(
	pack: FoundPack,
	root: string,
): Promise<string[]> {
	const packDir = join(root, pack.path);
	const files = pack.skills.map((skill) => skillTarget(skill.name));
	if (pack.assetDirs.includes("agents")) {
		const agents = await listAgentFiles(join(packDir, "agents"));
		files.push(...agents.map(agentTarget));
	}
	if (pack.assetDirs.includes("hooks")) {
		const hooks = await readDirEntries(join(packDir, "hooks"));
		files.push(...hooks.map(hookTarget));
	}
	return files;
}
