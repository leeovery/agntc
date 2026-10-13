import { join } from "node:path";
import { copyBareSkill } from "./copy-bare-skill.js";
import { type CopyResult, copyPack } from "./copy-pack.js";
import type { CopySource } from "./copy-safety.js";
import type { InstallItem } from "./install-item.js";

/**
 * Copies an item into the project: a skill's whole folder, or everything a
 * pack holds. The item's paths are relative to `source.root`.
 */
export async function copyItem(
	item: InstallItem,
	source: CopySource,
	installRoot: string,
): Promise<CopyResult> {
	if (item.kind === "pack") {
		return copyPack(item.pack, source, installRoot);
	}
	const { copiedFiles } = await copyBareSkill({
		sourceDir: join(source.root, item.skill.path),
		source,
		projectDir: installRoot,
		skillName: item.skill.name,
	});
	return { copiedFiles, assetCounts: { skills: 1 } };
}
