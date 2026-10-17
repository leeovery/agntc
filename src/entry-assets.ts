import {
	type AssetCounts,
	hookEntryName,
	identifyAssetType,
	skillFolderName,
} from "./asset-targets.js";
import { isInstalledSkill } from "./install-paths.js";
import type { ManifestEntry } from "./manifest.js";
import { formatAssetCounts, formatPackCounts } from "./summary.js";

/** What an entry's recorded files install; `other` counts files under no asset type. */
export interface EntryAssets {
	counts: AssetCounts;
	other: number;
}

/**
 * What the entry installs ({@link countAssets}), on one line: a pack's
 * counts as `add` words them, once it records something in `.claude/`;
 * otherwise, a skill's included, only the counts it has. Empty for an entry
 * recording no files.
 */
export function assetSummary(
	entry: ManifestEntry,
	{ counts, other }: EntryAssets,
): string {
	if (entry.files.length === 0) {
		return "";
	}
	const assets = usesPackWording(entry)
		? formatPackCounts(counts)
		: formatAssetCounts(counts);
	return [assets, other > 0 ? `${other} other` : ""]
		.filter((part) => part !== "")
		.join(", ");
}

/** An entry's kind, a pack's with what it installs: `pack · 2 skills, 1 folder`, as a row names one. */
export function kindAndCounts(entry: ManifestEntry, assets: string): string {
	const kind = entry.type ?? "skill";
	return kind === "pack" && assets !== "" ? `${kind} · ${assets}` : kind;
}

/**
 * Counts what an entry installs as `add` counts it, however many of its paths
 * are recorded: each `.claude/skills/<name>/` once, each top-level entry of
 * `.claude/hooks/` once, and each agent `.md` file. A pack's skills folder is
 * a skill or a support folder by what the install holds
 * ({@link isInstalledSkill}), as the manifest records the two alike; a skill
 * entry's is a skill by definition.
 */
export async function countAssets(
	entry: ManifestEntry,
	installRoot: string,
): Promise<EntryAssets> {
	const { files } = entry;
	const folders = distinct(files.map(skillFolderName));
	const skills =
		entry.type === "pack"
			? await countInstalledSkills(folders, installRoot)
			: folders.length;
	return {
		counts: {
			skills,
			folders: folders.length - skills,
			agents: files.filter(isAgentFile).length,
			hooks: distinct(files.map(hookEntryName)).length,
		},
		other: files.filter((file) => identifyAssetType(file) === null).length,
	};
}

async function countInstalledSkills(
	folders: string[],
	installRoot: string,
): Promise<number> {
	const isSkill = await Promise.all(
		folders.map((name) => isInstalledSkill(installRoot, name)),
	);
	return isSkill.filter(Boolean).length;
}

function distinct(names: (string | null)[]): string[] {
	return [...new Set(names.filter((name) => name !== null))];
}

/** An agent as `add` installs one: a `.md` file in `.claude/agents/`. */
function isAgentFile(file: string): boolean {
	return identifyAssetType(file) === "agents" && file.endsWith(".md");
}

/** A legacy pack recording only paths outside `.claude/` has no counts to word. */
function usesPackWording(entry: ManifestEntry): boolean {
	return (
		entry.type === "pack" &&
		entry.files.some((file) => identifyAssetType(file) !== null)
	);
}
