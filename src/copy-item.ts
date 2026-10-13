import { join } from "node:path";
import { copyBareSkill } from "./copy-bare-skill.js";
import { type CopyResult, copyPack } from "./copy-pack.js";
import type { InstallItem } from "./install-item.js";

/**
 * Copies an item into the project: a skill's whole folder, or everything a
 * pack holds. `root` is the source root the item's paths are relative to.
 */
export async function copyItem(
	item: InstallItem,
	root: string,
	installRoot: string,
): Promise<CopyResult> {
	if (item.kind === "pack") {
		return copyPack(item.pack, root, installRoot);
	}
	const { copiedFiles } = await copyBareSkill({
		sourceDir: join(root, item.skill.path),
		projectDir: installRoot,
		skillName: item.skill.name,
	});
	return { copiedFiles, assetCounts: { skills: 1 } };
}
