import type { FoundPack, FoundSkill } from "./discover.js";
import { joinWithAnd } from "./summary.js";

/** One thing `add` installs as one manifest entry: a lone skill or a whole pack. */
export type InstallItem =
	| { kind: "skill"; skill: FoundSkill }
	| { kind: "pack"; pack: FoundPack };

/** An item with the manifest key it installs under. */
export interface KeyedItem {
	item: InstallItem;
	key: string;
	/** The item's repo-relative path, recorded only when the key doesn't spell it. */
	sourceSubpath?: string;
}

export type KeyItemsResult =
	| { ok: true; items: KeyedItem[] }
	| { ok: false; message: string };

export function itemPath(item: InstallItem): string {
	return item.kind === "skill" ? item.skill.path : item.pack.path;
}

/** How a repo-relative path is shown: the path, or the root's name. */
export function pathLabel(path: string, rootName: string): string {
	return path || rootName;
}

export function itemLabel(item: InstallItem, rootName: string): string {
	return pathLabel(itemPath(item), rootName);
}

/** A pack holding no skills and no agents or hooks has nothing to install. */
export function isEmptyPack(pack: FoundPack): boolean {
	return pack.skills.length === 0 && pack.assetDirs.length === 0;
}

/**
 * Keys each item under the source key: a root item takes the source key, a
 * skill appends its folder name and a pack its repo-relative path. Refuses
 * when two items would share a key, naming their paths.
 */
export function keyItems(
	items: InstallItem[],
	sourceKey: string,
	rootName: string,
): KeyItemsResult {
	const keyed = items.map((item) => toKeyedItem(item, sourceKey));
	const clashes = findKeyClashes(keyed, rootName);
	if (clashes.length > 0) {
		return { ok: false, message: clashes.join("\n") };
	}
	return { ok: true, items: keyed };
}

function toKeyedItem(item: InstallItem, sourceKey: string): KeyedItem {
	const path = itemPath(item);
	const suffix = keySuffix(item);
	return {
		item,
		key: suffix === "" ? sourceKey : `${sourceKey}/${suffix}`,
		...(path !== suffix ? { sourceSubpath: path } : {}),
	};
}

function keySuffix(item: InstallItem): string {
	if (item.kind === "pack" || item.skill.path === "") {
		return itemPath(item);
	}
	return item.skill.name;
}

function findKeyClashes(keyed: KeyedItem[], rootName: string): string[] {
	const labelsByKey = new Map<string, string[]>();
	for (const { item, key } of keyed) {
		const labels = labelsByKey.get(key) ?? [];
		labelsByKey.set(key, [...labels, itemLabel(item, rootName)]);
	}
	return [...labelsByKey]
		.filter(([, labels]) => labels.length > 1)
		.map(
			([key, labels]) =>
				`${joinWithAnd(labels)} would share the key ${key} — choose one`,
		);
}
