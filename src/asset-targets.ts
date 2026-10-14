export type AssetType = "skills" | "agents" | "hooks";

/** What a copy installed, by asset type; `folders` counts a pack's support folders. */
export type AssetCounts = Partial<Record<AssetType | "folders", number>>;

const TARGET_DIRS: Record<AssetType, string> = {
	skills: ".claude/skills",
	agents: ".claude/agents",
	hooks: ".claude/hooks",
};

/** The install-root-relative directory an asset type is copied into. */
export function targetDir(assetType: AssetType): string {
	return TARGET_DIRS[assetType];
}

/** Whether `path` is `root` itself or lies below it; a sibling sharing its prefix is not. */
export function isUnderRoot(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

/** A single folder or file name: not empty, `.` or `..`, and holding no `/`. */
export function isSafeSegment(name: string): boolean {
	return name !== "" && name !== "." && name !== ".." && !name.includes("/");
}

/** The install-root-relative directory a skill installs as, trailing slash included. */
export function skillTarget(name: string): string {
	return `${targetDir("skills")}/${name}/`;
}

/**
 * The `<name>` of a path in a skill folder, `.claude/skills/<name>/` or
 * anything below it; null for a path in no skill folder, or a `<name>` that
 * isn't one safe segment.
 */
export function skillFolderName(path: string): string | null {
	const [name = "", ...below] = segmentsIn("skills", path);
	return below.length > 0 && isSafeSegment(name) ? name : null;
}

/**
 * The top-level entry of `.claude/hooks/` a path is or lies in, a file or a
 * folder, as `add` counts hooks; null for a path outside it, or a name that
 * isn't one safe segment.
 */
export function hookEntryName(path: string): string | null {
	const [name = ""] = segmentsIn("hooks", path);
	return isSafeSegment(name) ? name : null;
}

/** The segments of `path` below an asset type's directory; none outside it. */
function segmentsIn(assetType: AssetType, path: string): string[] {
	const prefix = `${targetDir(assetType)}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length).split("/") : [];
}

/** The asset type owning an install-root-relative file path, or null if none. */
export function identifyAssetType(filePath: string): AssetType | null {
	for (const [assetType, dir] of Object.entries(TARGET_DIRS)) {
		if (isUnderRoot(filePath, dir)) {
			return assetType as AssetType;
		}
	}
	return null;
}
