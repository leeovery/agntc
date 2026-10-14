import { join, posix } from "node:path";
import { targetDir } from "./asset-targets.js";
import { walkableFolders } from "./discover.js";
import { type InstallItem, itemPath } from "./install-item.js";
import { installPathMatcher, isSafeSegment } from "./install-paths.js";

const SKILLS_DIR = `${targetDir("skills")}/`;

/**
 * The folders an entry recorded directly in `.claude/skills/` that its
 * reinstall won't write, though a folder of that name is still in the item's
 * source: what an update would remove that upstream still has. It asks the
 * source alone, never the install rules, so a gap in those rules stops the
 * update instead of deleting what they miss. A namesake holding a skill the
 * item installs is a category whose skills now install on their own, so
 * dropping the folder loses nothing.
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
	const writes = installPathMatcher(incoming);
	const dropped = new Set(
		recorded
			.filter((path) => !writes(path))
			.map(recordedSkillFolder)
			.filter((name) => name !== null),
	);
	if (dropped.size === 0) {
		return [];
	}
	const found = await namesakes(root, itemPath(item), dropped);
	const installs = installedSkillPaths(item);
	const isCategory = (path: string) =>
		installs.some((skill) => skill.startsWith(`${path}/`));
	return [...dropped].filter((name) => {
		const paths = found.get(name) ?? [];
		return paths.length > 0 && !paths.some(isCategory);
	});
}

/** The `<name>` of a recorded `.claude/skills/<name>/`; null for anything else. */
function recordedSkillFolder(path: string): string | null {
	if (!path.startsWith(SKILLS_DIR) || !path.endsWith("/")) {
		return null;
	}
	const name = path.slice(SKILLS_DIR.length, -1);
	return isSafeSegment(name) ? name : null;
}

/**
 * The root-relative paths of every folder below `base` named in `names`, at
 * any depth, entering only the folders the walk would.
 */
async function namesakes(
	root: string,
	base: string,
	names: ReadonlySet<string>,
): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();
	const visit = async (dir: string): Promise<void> => {
		for (const { name } of await walkableFolders(join(root, dir))) {
			const path = posix.join(dir, name);
			if (names.has(name)) {
				found.set(name, [...(found.get(name) ?? []), path]);
			}
			await visit(path);
		}
	};
	await visit(base);
	return found;
}

function installedSkillPaths(item: InstallItem): string[] {
	return item.kind === "pack"
		? item.pack.skills.map(({ path }) => path)
		: [item.skill.path];
}
