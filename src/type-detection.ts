import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssetType } from "./drivers/types.js";

export const ASSET_DIRS = [
	"skills",
	"agents",
	"hooks",
] as const satisfies readonly AssetType[];

interface BareSkill {
	type: "bare-skill";
}

interface Plugin {
	type: "plugin";
	assetDirs: AssetType[];
}

interface Collection {
	type: "collection";
	plugins: string[];
}

interface NotAgntc {
	type: "not-agntc";
}

export type DetectedType = BareSkill | Plugin | Collection | NotAgntc;

export interface DetectTypeOptions {
	configType?: string;
	forcePlugin?: boolean;
	onWarn?: (message: string) => void;
}

/**
 * Internal structural classification of a directory, richer than the public
 * {@link DetectedType} union. The `skills-only` kind captures the structurally
 * ambiguous case (a root containing only `skills/`) so the override layer
 * (task 1-4) can decide between bundling it as a plugin or treating it as a
 * collection. The public union stays stable; mapping happens in detectType.
 */
type StructuralKind =
	| { kind: "skills-only" }
	| { kind: "plugin"; assetDirs: AssetType[] }
	| { kind: "bare-skill" }
	| { kind: "members"; plugins: string[] }
	| { kind: "none" };

export async function detectType(
	dir: string,
	options: DetectTypeOptions,
): Promise<DetectedType> {
	const { onWarn } = options;
	const structure = await classifyStructure(dir, onWarn);

	switch (structure.kind) {
		case "plugin":
			return { type: "plugin", assetDirs: structure.assetDirs };
		case "bare-skill":
			return { type: "bare-skill" };
		case "skills-only":
			// Ambiguous: defaults to collection until the override layer (task 1-4)
			// applies configType/forcePlugin to bundle it as a plugin.
			return { type: "collection", plugins: [] };
		case "members":
			return { type: "collection", plugins: structure.plugins };
		default:
			return { type: "not-agntc" };
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function classifyStructure(
	dir: string,
	onWarn?: (message: string) => void,
): Promise<StructuralKind> {
	const foundAssetDirs: AssetType[] = [];
	for (const assetDir of ASSET_DIRS) {
		if (await exists(join(dir, assetDir))) {
			foundAssetDirs.push(assetDir);
		}
	}

	const hasSkillMd = await exists(join(dir, "SKILL.md"));
	const skillsOnly =
		foundAssetDirs.length === 1 && foundAssetDirs[0] === "skills";

	// Plugin: ≥1 asset dir that is not the skills-only case.
	if (foundAssetDirs.length > 0 && !skillsOnly) {
		if (hasSkillMd) {
			onWarn?.(
				"SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
			);
		}
		return { kind: "plugin", assetDirs: foundAssetDirs };
	}

	// Skills-only: structurally ambiguous, resolved by the override layer (1-4).
	if (skillsOnly) {
		return { kind: "skills-only" };
	}

	if (hasSkillMd) {
		return { kind: "bare-skill" };
	}

	return scanCollectionMembers(dir);
}

/**
 * Scans immediate child dirs for structural collection members (task 1-3).
 * Membership is purely structural and goes exactly one level down: a child
 * qualifies if it resolves to a unit on its own root. No recursion into
 * grandchildren and no reliance on `agntc.json`.
 */
async function scanCollectionMembers(dir: string): Promise<StructuralKind> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return { kind: "none" };
	}

	const plugins: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		if (await qualifiesAsMember(join(dir, entry.name))) {
			plugins.push(entry.name);
		}
	}

	if (plugins.length > 0) {
		plugins.sort();
		return { kind: "members", plugins };
	}

	return { kind: "none" };
}

/**
 * A child dir qualifies as a collection member if it structurally resolves to a
 * unit at its own root: a bare-skill (`SKILL.md`) or a plugin (≥1 asset-kind
 * dir). Checks the child's root only — never recurses into grandchildren, so a
 * child that is itself only a collection is not a member (nested collections are
 * unsupported).
 */
async function qualifiesAsMember(childDir: string): Promise<boolean> {
	if (await exists(join(childDir, "SKILL.md"))) {
		return true;
	}
	for (const assetDir of ASSET_DIRS) {
		if (await exists(join(childDir, assetDir))) {
			return true;
		}
	}
	return false;
}
