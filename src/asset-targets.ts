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

/** The install-root-relative directory a skill installs as, trailing slash included. */
export function skillTarget(name: string): string {
	return `${targetDir("skills")}/${name}/`;
}

/** The asset type owning an install-root-relative file path, or null if none. */
export function identifyAssetType(filePath: string): AssetType | null {
	for (const [assetType, dir] of Object.entries(TARGET_DIRS)) {
		if (filePath.startsWith(dir)) {
			return assetType as AssetType;
		}
	}
	return null;
}
