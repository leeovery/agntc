import { join } from "node:path";
import type { AssetCounts } from "./asset-targets.js";
import { copyBareSkill, skillUnit } from "./copy-bare-skill.js";
import {
	type CopyResult,
	copyPack,
	packCounts,
	packUnits,
} from "./copy-pack.js";
import {
	type CopySource,
	type CopyUnit,
	checkEscapingSymlinks,
	type EscapeCheck,
} from "./copy-safety.js";
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
	return { copiedFiles, assetCounts: skillCounts() };
}

function skillCounts(): AssetCounts {
	return { skills: 1 };
}

/** What {@link copyItem} would install, counted as its copy counts it, without copying. */
export async function countItem(
	item: InstallItem,
	root: string,
): Promise<AssetCounts> {
	return item.kind === "pack" ? packCounts(item.pack, root) : skillCounts();
}

/** The folders {@link copyItem} plans for an item, each with its filter. */
export async function copyUnits(
	item: InstallItem,
	root: string,
): Promise<CopyUnit[]> {
	if (item.kind === "pack") {
		return packUnits(item.pack, root);
	}
	return [skillUnit(join(root, item.skill.path))];
}

/**
 * The symlink-escape pre-flight for an item: plans each folder copying it
 * from `source` plans, as that copy will, stopping at the first link out of
 * the source root.
 */
export async function checkItemLinks(
	item: InstallItem,
	source: CopySource,
): Promise<EscapeCheck> {
	for (const { dir, keep } of await copyUnits(item, source.root)) {
		const check = await checkEscapingSymlinks(dir, source, keep);
		if (!check.ok) {
			return check;
		}
	}
	return { ok: true };
}
