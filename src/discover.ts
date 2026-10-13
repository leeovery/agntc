import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { readConfig } from "./config.js";
import { assertSubpathWithinClone } from "./copy-safety.js";
import { readSkillFrontmatter } from "./frontmatter.js";
import { pathExists } from "./fs-utils.js";

export type PackAssetDir = "agents" | "hooks";

export interface FoundSkill {
	name: string;
	path: string;
	frontmatterName?: string;
	description?: string;
}

export interface FoundPack {
	name: string;
	path: string;
	skills: FoundSkill[];
	assetDirs: PackAssetDir[];
}

export interface StrayAssets {
	path: string;
	assetDirs: PackAssetDir[];
}

export interface Discovery {
	packs: FoundPack[];
	skills: FoundSkill[];
	strays: StrayAssets[];
}

export interface DiscoverOptions {
	startPath?: string;
	forcePack?: boolean;
	rootName: string;
	onWarn?: (message: string) => void;
}

export interface SkillMatch {
	skill: FoundSkill;
	pack?: FoundPack;
}

export interface AmbiguousMatch {
	name: string;
	paths: string[];
}

export interface MatchResult {
	matched: SkillMatch[];
	missing: string[];
	ambiguous: AmbiguousMatch[];
}

/** Why a folder can't be bundled as one pack. */
export type PackConflict = "single-skill" | "contains-packs";

/** Raised when `--pack` asks to bundle a folder that can't be one pack. */
export class PackConflictError extends Error {
	readonly conflict: PackConflict;

	constructor(message: string, conflict: PackConflict) {
		super(message);
		this.name = "PackConflictError";
		this.conflict = conflict;
	}
}

/** Raised when `startPath` doesn't name a real directory inside the source. */
export class StartPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StartPathError";
	}
}

const MAX_DEPTH = 5;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "vendor"]);
const PACK_TYPES = new Set(["pack", "plugin"]);
const PACK_ASSET_DIRS: readonly PackAssetDir[] = ["agents", "hooks"];
const ASSET_FILE_TESTS: Record<PackAssetDir, (entry: Dirent) => boolean> = {
	agents: (entry) => entry.isFile() && entry.name.endsWith(".md"),
	hooks: (entry) => entry.isFile(),
};

type FolderKind = "skill" | "pack" | "plain";
type WalkMode = "outer" | "pack";

interface Context {
	root: string;
	rootName: string;
	onWarn?: (message: string) => void;
}

interface WalkResult {
	packs: string[];
	skills: string[];
	strays: StrayAssets[];
}

export async function discover(
	root: string,
	options: DiscoverOptions,
): Promise<Discovery> {
	const ctx: Context = {
		root,
		rootName: options.rootName,
		onWarn: options.onWarn,
	};
	const start = await resolveStartPath(root, options.startPath ?? "");

	switch (await classifyFolder(ctx, start, true)) {
		case "skill":
			if (options.forcePack) {
				throw new PackConflictError(
					`"${displayPath(ctx, start)}" is a single skill — --pack can't bundle it`,
					"single-skill",
				);
			}
			return {
				packs: [],
				skills: [await toFoundSkill(ctx, start)],
				strays: [],
			};
		case "pack":
			return onlyPack(await toFoundPack(ctx, start));
		default:
			return options.forcePack
				? forcePackAt(ctx, start)
				: discoverWithin(ctx, start);
	}
}

/**
 * Resolves `--skill` names against everything discovered: a name matches a
 * skill's folder name or frontmatter name, loose or inside a pack.
 */
export function matchSkills(
	discovery: Discovery,
	wanted: string[],
): MatchResult {
	const candidates = allSkills(discovery);
	const result: MatchResult = { matched: [], missing: [], ambiguous: [] };
	const matchedPaths = new Set<string>();

	for (const name of new Set(wanted)) {
		const hits = candidates.filter(
			({ skill }) => skill.name === name || skill.frontmatterName === name,
		);
		const [hit] = hits;
		if (hit === undefined) {
			result.missing.push(name);
		} else if (hits.length > 1) {
			result.ambiguous.push({
				name,
				paths: hits.map(({ skill }) => skill.path),
			});
		} else if (!matchedPaths.has(hit.skill.path)) {
			matchedPaths.add(hit.skill.path);
			result.matched.push(hit);
		}
	}
	return result;
}

function allSkills(discovery: Discovery): SkillMatch[] {
	const loose = discovery.skills.map((skill) => ({ skill }));
	const packed = discovery.packs.flatMap((pack) =>
		pack.skills.map((skill) => ({ skill, pack })),
	);
	return [...loose, ...packed].sort((a, b) =>
		comparePaths(a.skill.path, b.skill.path),
	);
}

async function resolveStartPath(root: string, given: string): Promise<string> {
	assertSubpathWithinClone(root, given);
	const start = posix.normalize(given).replace(/\/+$/, "");
	if (start === "." || start === "") {
		return "";
	}
	await assertRealDirectory(root, start, given);
	return start;
}

/**
 * Checks each segment with `lstat` so a start path can't reach through a
 * symlinked directory, which the walk itself never follows either.
 */
async function assertRealDirectory(
	root: string,
	start: string,
	given: string,
): Promise<void> {
	let current = root;
	for (const segment of start.split("/")) {
		current = join(current, segment);
		const stats = await lstat(current).catch(() => null);
		if (stats === null) {
			throw new StartPathError(`path "${given}" not found in source`);
		}
		if (!stats.isDirectory()) {
			throw new StartPathError(`path "${given}" is not a directory in source`);
		}
	}
}

async function discoverWithin(ctx: Context, start: string): Promise<Discovery> {
	const found = await walk(ctx, start, "outer");
	const packPaths = found.packs.sort(comparePaths);
	return {
		packs: await Promise.all(packPaths.map((path) => toFoundPack(ctx, path))),
		skills: await toFoundSkills(ctx, found.skills),
		strays: found.strays.sort((a, b) => comparePaths(a.path, b.path)),
	};
}

async function forcePackAt(ctx: Context, start: string): Promise<Discovery> {
	const { packs } = await walk(ctx, start, "outer");
	if (packs.length > 0) {
		throw new PackConflictError(
			`"${displayPath(ctx, start)}" contains packs (${packs.sort(comparePaths).join(", ")}) — --pack can't bundle it`,
			"contains-packs",
		);
	}
	return onlyPack(await toFoundPack(ctx, start));
}

function onlyPack(pack: FoundPack): Discovery {
	return { packs: [pack], skills: [], strays: [] };
}

async function toFoundPack(ctx: Context, path: string): Promise<FoundPack> {
	const { skills } = await walk(ctx, path, "pack");
	const abs = absolute(ctx, path);
	return {
		name: folderName(ctx, path),
		path,
		skills: await toFoundSkills(ctx, skills),
		assetDirs: await qualifyingAssetDirs(abs, await readEntries(abs)),
	};
}

async function toFoundSkills(
	ctx: Context,
	paths: string[],
): Promise<FoundSkill[]> {
	const skills = await Promise.all(
		paths.map((path) => toFoundSkill(ctx, path)),
	);
	return skills.sort((a, b) => comparePaths(a.path, b.path));
}

async function toFoundSkill(ctx: Context, path: string): Promise<FoundSkill> {
	const { name, description } = await readSkillFrontmatter(absolute(ctx, path));
	return {
		name: folderName(ctx, path),
		path,
		...(name !== undefined ? { frontmatterName: name } : {}),
		...(description !== undefined ? { description } : {}),
	};
}

/**
 * Walks the descendants of `base`. In `outer` mode declared packs are recorded
 * and not entered, and plain folders with qualifying assets become strays. In
 * `pack` mode packs don't nest, so inner declarations are plain folders, and
 * the pack's own top-level asset dirs aren't searched for skills.
 */
async function walk(
	ctx: Context,
	base: string,
	mode: WalkMode,
): Promise<WalkResult> {
	const result: WalkResult = { packs: [], skills: [], strays: [] };
	await walkChildren(ctx, base, 0, mode, result);
	return result;
}

async function walkChildren(
	ctx: Context,
	path: string,
	depth: number,
	mode: WalkMode,
	result: WalkResult,
): Promise<void> {
	if (depth >= MAX_DEPTH) {
		return;
	}
	const abs = absolute(ctx, path);
	const entries = await readEntries(abs);

	if (mode === "outer") {
		await recordStray(abs, path, entries, result);
	}

	for (const entry of entries) {
		if (!isWalkable(entry) || isOwnAssetDir(entry, depth, mode)) {
			continue;
		}
		await visit(ctx, joinPath(path, entry.name), depth + 1, mode, result);
	}
}

async function visit(
	ctx: Context,
	path: string,
	depth: number,
	mode: WalkMode,
	result: WalkResult,
): Promise<void> {
	const kind = await classifyFolder(ctx, path, mode === "outer");
	if (kind === "skill") {
		result.skills.push(path);
	} else if (kind === "pack") {
		result.packs.push(path);
	} else {
		await walkChildren(ctx, path, depth, mode, result);
	}
}

async function recordStray(
	abs: string,
	path: string,
	entries: Dirent[],
	result: WalkResult,
): Promise<void> {
	const assetDirs = await qualifyingAssetDirs(abs, entries);
	if (assetDirs.length > 0) {
		result.strays.push({ path, assetDirs });
	}
}

async function classifyFolder(
	ctx: Context,
	path: string,
	packsDeclarable: boolean,
): Promise<FolderKind> {
	const abs = absolute(ctx, path);
	const isSkill = await pathExists(join(abs, "SKILL.md"));
	const isPack = packsDeclarable && (await declaresPack(abs, ctx.onWarn));
	if (isSkill && isPack) {
		ctx.onWarn?.(
			`"${displayPath(ctx, path)}" has SKILL.md and declares a pack — treating it as a skill`,
		);
	}
	if (isSkill) {
		return "skill";
	}
	return isPack ? "pack" : "plain";
}

async function declaresPack(
	abs: string,
	onWarn?: (message: string) => void,
): Promise<boolean> {
	const config = await readConfig(abs, { onWarn });
	return PACK_TYPES.has(config?.type ?? "");
}

async function qualifyingAssetDirs(
	abs: string,
	entries: Dirent[],
): Promise<PackAssetDir[]> {
	const found: PackAssetDir[] = [];
	for (const assetDir of PACK_ASSET_DIRS) {
		const present = entries.some(
			(entry) => entry.name === assetDir && entry.isDirectory(),
		);
		if (
			present &&
			(await containsFile(join(abs, assetDir), ASSET_FILE_TESTS[assetDir]))
		) {
			found.push(assetDir);
		}
	}
	return found;
}

async function containsFile(
	dir: string,
	matches: (entry: Dirent) => boolean,
): Promise<boolean> {
	const visible = (await readEntries(dir)).filter((entry) => !isHidden(entry));
	for (const entry of visible) {
		if (matches(entry)) {
			return true;
		}
		if (
			entry.isDirectory() &&
			(await containsFile(join(dir, entry.name), matches))
		) {
			return true;
		}
	}
	return false;
}

/** Symlinked directories report as symlinks here, so they are never entered. */
async function readEntries(dir: string): Promise<Dirent[]> {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function isWalkable(entry: Dirent): boolean {
	return (
		entry.isDirectory() && !isHidden(entry) && !SKIPPED_DIRS.has(entry.name)
	);
}

function isHidden(entry: Dirent): boolean {
	return entry.name.startsWith(".");
}

function isOwnAssetDir(entry: Dirent, depth: number, mode: WalkMode): boolean {
	return (
		mode === "pack" &&
		depth === 0 &&
		(PACK_ASSET_DIRS as readonly string[]).includes(entry.name)
	);
}

function absolute(ctx: Context, path: string): string {
	return join(ctx.root, path);
}

function folderName(ctx: Context, path: string): string {
	return path === "" ? ctx.rootName : posix.basename(path);
}

function displayPath(ctx: Context, path: string): string {
	return path === "" ? ctx.rootName : path;
}

function joinPath(parent: string, name: string): string {
	return parent === "" ? name : `${parent}/${name}`;
}

export function comparePaths(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	return a < b ? -1 : 1;
}
