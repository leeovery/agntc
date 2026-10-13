export type AssetType = "skills" | "agents" | "hooks";

export type AssetCounts = Partial<Record<AssetType, number>>;

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

/** The install-root-relative directory a skill installs as, trailing slash included. */
export function skillTarget(name: string): string {
	return `${targetDir("skills")}/${name}/`;
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
