import { join, posix } from "node:path";
import { skillFolderName, skillTarget } from "./asset-targets.js";
import {
	MAX_DEPTH,
	PACK_ASSET_DIRS,
	skillFolders,
	walkableFolders,
} from "./discover.js";
import { type InstallItem, itemPath } from "./install-item.js";
import { installPathMatcher } from "./install-paths.js";

/**
 * The folders an entry recorded directly in `.claude/skills/` that its
 * reinstall won't write, though a folder of that name is still in the item's
 * source outside everything the item installs: what an update would remove
 * that upstream still has. It asks the source alone, never the install rules,
 * so a gap in those rules stops the update instead of deleting what they
 * miss. A namesake inside a folder the item installs still installs, nested
 * in it, and a namesake holding one is a category whose contents now install
 * on their own, so dropping the folder loses nothing.
 *
 * `recorded` is the entry's files, `incoming` what its reinstall writes, and
 * `root` the source root the item's paths are relative to. The source is
 * walked only when a folder would be dropped.
 */
export async function droppedButInSource(
	recorded: readonly string[],
	incoming: readonly string[],
	item: InstallItem,
	root: string,
): Promise<string[]> {
	const dropped = droppedFolders(recorded, incoming);
	if (dropped.size === 0) {
		return [];
	}
	const installs = installedFolders(item);
	const found = await namesakes(root, itemPath(item), dropped, [
		...installs,
		...ownAssetDirs(item),
	]);
	const isCategory = (path: string) =>
		installs.some((folder) => folder.startsWith(`${path}/`));
	return [...dropped].filter((name) => {
		const paths = found.get(name) ?? [];
		return paths.length > 0 && !paths.some(isCategory);
	});
}

/** The names of the recorded skill folders the reinstall won't write. */
function droppedFolders(
	recorded: readonly string[],
	incoming: readonly string[],
): Set<string> {
	const writes = installPathMatcher(incoming);
	const dropped = new Set<string>();
	for (const path of recorded) {
		const name = skillFolderName(path);
		const isFolder = name !== null && path === skillTarget(name);
		if (isFolder && !writes(path)) {
			dropped.add(name);
		}
	}
	return dropped;
}

/**
 * The root-relative paths of every folder below `base` named in `names`, as
 * deep as discovery reads, entering only the folders the walk would and none
 * in `closed`.
 */
async function namesakes(
	root: string,
	base: string,
	names: ReadonlySet<string>,
	closed: readonly string[],
): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();
	const visit = async (dir: string, depth: number): Promise<void> => {
		if (depth >= MAX_DEPTH || closed.includes(dir)) {
			return;
		}
		for (const { name } of await walkableFolders(join(root, dir))) {
			const path = posix.join(dir, name);
			if (names.has(name)) {
				found.set(name, [...(found.get(name) ?? []), path]);
			}
			await visit(path, depth + 1);
		}
	};
	await visit(base, 0);
	return found;
}

/** The folders an item installs whole: a pack's skill folders, or the skill's own. */
function installedFolders(item: InstallItem): string[] {
	return item.kind === "pack"
		? skillFolders(item.pack).map(({ path }) => path)
		: [item.skill.path];
}

/** A pack's own `agents/` and `hooks/`, which never install to `.claude/skills/`. */
function ownAssetDirs(item: InstallItem): string[] {
	return item.kind === "pack"
		? PACK_ASSET_DIRS.map((dir) => posix.join(item.pack.path, dir))
		: [];
}
