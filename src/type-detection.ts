import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssetType } from "./drivers/types.js";
import { pathExists } from "./fs-utils.js";

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

/**
 * Raised pre-flight when an override (`type: plugin` config or the `--plugin`
 * flag) contradicts an *unambiguous* structure that cannot be bundled. The
 * message carries only the structural half of the conflict (e.g. "a bare skill
 * — cannot bundle"); the caller (Phase 2/3) prepends the source identity
 * (`owner/repo`). Overrides resolve the skills-only ambiguity only; anything
 * else they contradict is unrealizable and therefore a hard error.
 */
export class TypeConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TypeConflictError";
	}
}

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
	const { configType, forcePlugin, onWarn } = options;
	const structure = await classifyStructure(dir, onWarn);

	// Precedence --plugin > config type. Observable only in the skills-only case
	// where both push the same way, so centralising it here keeps one resolved
	// answer for Phase 2 callers. Only the exact string "plugin" is recognised;
	// every other config type value is treated as absent.
	const wantsPlugin = forcePlugin === true || configType === "plugin";

	switch (structure.kind) {
		case "plugin":
			// Already a plugin; an override agreeing is a redundant no-op.
			return { type: "plugin", assetDirs: structure.assetDirs };
		case "bare-skill":
			if (wantsPlugin) {
				throw new TypeConflictError(
					"the source is a bare skill — cannot bundle",
				);
			}
			return { type: "bare-skill" };
		case "skills-only":
			// The single ambiguous case overrides resolve.
			return wantsPlugin
				? { type: "plugin", assetDirs: ["skills"] }
				: { type: "collection", plugins: [] };
		case "members":
			if (wantsPlugin) {
				throw new TypeConflictError(
					`its structure is a collection of ${structure.plugins.length} members — cannot bundle`,
				);
			}
			return { type: "collection", plugins: structure.plugins };
		default:
			// not-agntc: overrides are irrelevant, never a conflict.
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

/**
 * Scans {@link ASSET_DIRS} directly under `root` and returns those present, in
 * ASSET_DIRS iteration order. The single source of the "which asset-kind dirs
 * exist under this root" query consumed by structure classification, collection
 * membership, and recorded-plugin replay — keeping the scan loop (and its
 * ordering) authored once.
 *
 * Uses {@link pathExists} (fs-utils) — the same existence primitive the replay
 * call site already used — so centralising the scan preserves replay behaviour
 * exactly. The local {@link exists} (still used for the SKILL.md checks) and
 * pathExists are byte-identical today; unifying the two primitives is task 1-5,
 * deliberately not pre-empted here.
 */
export async function findPresentAssetDirs(root: string): Promise<AssetType[]> {
	const present: AssetType[] = [];
	for (const assetDir of ASSET_DIRS) {
		if (await pathExists(join(root, assetDir))) {
			present.push(assetDir);
		}
	}
	return present;
}

async function classifyStructure(
	dir: string,
	onWarn?: (message: string) => void,
): Promise<StructuralKind> {
	const foundAssetDirs = await findPresentAssetDirs(dir);

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
	return (await findPresentAssetDirs(childDir)).length > 0;
}
