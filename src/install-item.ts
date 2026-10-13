import {
	type Claim,
	computeClaims,
	describeClash,
	findTargetClashes,
} from "./compute-incoming-files.js";
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
	/** The install paths copying the item would claim. */
	claims: Claim[];
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
 * skill appends its folder name and a pack its repo-relative path. Refuses,
 * naming the paths, when two items would install to one place or, failing
 * that, share a key. `root` is the source root the items' paths are relative to.
 */
export async function keyItems(
	items: InstallItem[],
	sourceKey: string,
	rootName: string,
	root: string,
): Promise<KeyItemsResult> {
	const keyed = await Promise.all(
		items.map(async (item) =>
			toKeyedItem(item, sourceKey, await computeClaims(item, root)),
		),
	);
	const targetClashes = findTargetClashLines(keyed);
	const clashes =
		targetClashes.length > 0 ? targetClashes : findKeyClashes(keyed, rootName);
	if (clashes.length > 0) {
		return { ok: false, message: clashes.join("\n") };
	}
	return { ok: true, items: keyed };
}

function toKeyedItem(
	item: InstallItem,
	sourceKey: string,
	claims: Claim[],
): KeyedItem {
	const path = itemPath(item);
	const suffix = keySuffix(item);
	return {
		item,
		key: suffix === "" ? sourceKey : `${sourceKey}/${suffix}`,
		...(path !== suffix ? { sourceSubpath: path } : {}),
		claims,
	};
}

function keySuffix(item: InstallItem): string {
	if (item.kind === "pack" || item.skill.path === "") {
		return itemPath(item);
	}
	return item.skill.name;
}

function findTargetClashLines(keyed: KeyedItem[]): string[] {
	return findTargetClashes(keyed.flatMap(({ claims }) => claims)).map(
		(clash) => `${describeClash(clash)} — choose one`,
	);
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
