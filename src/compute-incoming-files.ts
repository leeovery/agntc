import { join, posix } from "node:path";
import { skillTarget } from "./asset-targets.js";
import {
	agentTarget,
	hookTarget,
	listAgentFiles,
	listHookEntries,
} from "./copy-pack.js";
import { type FoundPack, type SkillFolder, skillFolders } from "./discover.js";
import type { InstallItem } from "./install-item.js";
import { withoutTrailingSlash } from "./install-paths.js";
import { joinWithAnd } from "./summary.js";

/** An install path an item claims, and the repo-relative path it's copied from. */
export interface Claim {
	target: string;
	source: string;
}

/** An install path more than one source path claims. */
export interface TargetClash {
	target: string;
	sources: string[];
}

/**
 * Predicts the install paths copying an item would claim, without copying, so
 * collision and unmanaged checks can run before anything is written. `root` is
 * the source root the item's paths are relative to.
 */
export async function computeIncomingFiles(
	item: InstallItem,
	root: string,
): Promise<string[]> {
	const claims = await computeClaims(item, root);
	return claims.map(({ target }) => target);
}

/** What {@link computeIncomingFiles} predicts, with the source path behind each. */
export async function computeClaims(
	item: InstallItem,
	root: string,
): Promise<Claim[]> {
	if (item.kind === "skill") {
		return skillClaims([item.skill]);
	}
	return [
		...skillClaims(skillFolders(item.pack)),
		...(await packAssetClaims(item.pack, root)),
	];
}

/**
 * Skills, and a pack's support folders, install flat by folder name, so each
 * claims `.claude/skills/<name>/`.
 */
export function skillClaims(folders: readonly SkillFolder[]): Claim[] {
	return folders.map((folder) => ({
		target: skillTarget(folder.name),
		source: folder.path,
	}));
}

/** The install paths claimed more than once, in the order first claimed. */
export function findTargetClashes(claims: Claim[]): TargetClash[] {
	const sourcesByTarget = new Map<string, string[]>();
	for (const { target, source } of claims) {
		const path = withoutTrailingSlash(target);
		sourcesByTarget.set(path, [...(sourcesByTarget.get(path) ?? []), source]);
	}
	return [...sourcesByTarget]
		.filter(([, sources]) => sources.length > 1)
		.map(([target, sources]) => ({ target, sources }));
}

export function describeClash({ target, sources }: TargetClash): string {
	const quantifier = sources.length > 2 ? "all" : "both";
	return `${joinWithAnd(sources)} would ${quantifier} install to ${target}`;
}

async function packAssetClaims(
	pack: FoundPack,
	root: string,
): Promise<Claim[]> {
	const packDir = join(root, pack.path);
	const claims: Claim[] = [];
	if (pack.assetDirs.includes("agents")) {
		const agents = await listAgentFiles(join(packDir, "agents"));
		for (const relPath of agents) {
			claims.push({
				target: agentTarget(relPath),
				source: posix.join(pack.path, "agents", relPath),
			});
		}
	}
	if (pack.assetDirs.includes("hooks")) {
		const hooks = await listHookEntries(join(packDir, "hooks"));
		for (const entry of hooks) {
			claims.push({
				target: hookTarget(entry),
				source: posix.join(pack.path, "hooks", entry.name),
			});
		}
	}
	return claims;
}
