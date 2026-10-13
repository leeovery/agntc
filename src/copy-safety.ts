import type { Dirent } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readlink,
	symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { relativePosix } from "./fs-utils.js";

/**
 * Pure lexical containment predicate: does `candidate` resolve at or below
 * `root`? Boundary-correct (relative()-based, never startsWith) so sibling
 * directories sharing a prefix (`/clone` vs `/clone-evil`) are NOT contained.
 * No filesystem access.
 */
export function isContained(root: string, candidate: string): boolean {
	const rel = relative(resolve(root), candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class PathTraversalError extends Error {
	constructor(subpath: string) {
		super(`subpath "${subpath}" resolves outside the clone root`);
		this.name = "PathTraversalError";
	}
}

/**
 * Asserts that a source-supplied subpath, resolved against the clone root,
 * stays at or below the clone root.
 *
 * No-op when there is no subpath (whole-repo / bare-skill install).
 *
 * Pure lexical containment predicate over path strings (mirrors Vercel's
 * isSubpathSafe): no filesystem access, no logging, no process.exit. A
 * violation throws {@link PathTraversalError} for the caller to map to a
 * pre-flight abort.
 */
export function assertSubpathWithinClone(
	cloneRoot: string,
	subpath: string | null | undefined,
): void {
	if (subpath === null || subpath === undefined || subpath === "") {
		return;
	}

	if (!isContained(cloneRoot, resolve(cloneRoot, subpath))) {
		throw new PathTraversalError(subpath);
	}
}

/** What a `/`-joined path below a source root leads to, found without following a link. */
export type SourcePathState =
	| { kind: "directory" }
	| { kind: "missing" }
	| { kind: "not-directory" }
	/** A symlink at the path or at a folder above it, as a path below the root. */
	| { kind: "link"; at: string };

/**
 * Walks a path below `root` one segment at a time with `lstat`, stopping at the
 * first that is missing, a symlink or not a folder, so nothing reached through
 * the path can lie behind a link: the deep walk never follows one either.
 */
export async function inspectSourcePath(
	root: string,
	path: string,
): Promise<SourcePathState> {
	let current = "";
	for (const segment of path.split("/").filter(Boolean)) {
		current = current === "" ? segment : `${current}/${segment}`;
		const stats = await lstat(join(root, current)).catch(() => null);
		if (stats === null) {
			return { kind: "missing" };
		}
		if (stats.isSymbolicLink()) {
			return { kind: "link", at: current };
		}
		if (!stats.isDirectory()) {
			return { kind: "not-directory" };
		}
	}
	return { kind: "directory" };
}

export class SymlinkEscapeError extends Error {
	constructor(relPath: string, target: string) {
		super(`symlink "${relPath}" points outside the clone (target: ${target})`);
		this.name = "SymlinkEscapeError";
	}
}

/**
 * Pre-flight that refuses, before anything is written or removed, every link
 * the copy of one folder could read that leads out of the source root: those
 * in it the filter keeps, and, from a clone, those in a folder elsewhere it
 * would bring in a link's place. A local source links to such a folder, so it
 * isn't read.
 *
 * It plans that very copy, `dir` from `source` kept by `keep`, so it reads
 * what the copy reads and no more: no link is followed, and a dangling one is
 * judged by where it points. Throws {@link SymlinkEscapeError} on the first
 * escaping link. Read-only.
 */
export async function scanForEscapingSymlinks(
	dir: string,
	source: CopySource,
	keep: CopyFilter,
): Promise<void> {
	await planCopy({ dir, keep }, source);
}

/** What the symlink-escape pre-flight found: nothing, or the escaping link. */
export type EscapeCheck = { ok: true } | { ok: false; message: string };

/**
 * Scan-and-narrow wrapper around {@link scanForEscapingSymlinks}: runs the
 * symlink-escape pre-flight and maps the outcome to a discriminated result so
 * callers own only their distinct surfacing. A {@link SymlinkEscapeError} is
 * narrowed to `{ ok: false, message }` (the error's message verbatim); any
 * other error RETHROWS unchanged. Success resolves to `{ ok: true }`.
 */
export async function checkEscapingSymlinks(
	dir: string,
	source: CopySource,
	keep: CopyFilter,
): Promise<EscapeCheck> {
	try {
		await scanForEscapingSymlinks(dir, source, keep);
		return { ok: true };
	} catch (err) {
		if (err instanceof SymlinkEscapeError) {
			return { ok: false, message: err.message };
		}
		throw err;
	}
}

/**
 * Where a link leads, resolved from where it sits without following it, so a
 * dangling link is judged the same way. One leading out of `root` throws,
 * naming the link by where it sits below `root`.
 */
async function containedTarget(link: string, root: string): Promise<string> {
	const written = await readlink(link);
	const target = resolve(dirname(link), written);
	if (!isContained(root, target)) {
		throw new SymlinkEscapeError(relativePosix(root, link), written);
	}
	return target;
}

/**
 * Whether a `/`-joined path is a `.git` or lies below one: history, never
 * content. Any letter case counts, as a filesystem that ignores case reads
 * `.GIT` as `.git`.
 */
export function inGitFolder(path: string): boolean {
	return path.split("/").some((name) => name.toLowerCase() === ".git");
}

/** What an item is copied from: the root its paths sit below, and its kind. */
export interface CopySource {
	root: string;
	/** A local folder, which stays; otherwise a clone, deleted once copied. */
	local: boolean;
}

/** One thing a copy writes, at a `/`-joined path below its destination; "" is the destination. */
export type CopyStep =
	| { kind: "dir"; path: string }
	| { kind: "file"; path: string; from: string }
	| { kind: "link"; path: string; target: string };

/** Whether a copy keeps what sits at a `/`-joined path below the folder it copies. */
export type CopyFilter = (path: string) => boolean;

/** A folder a copy plans, and the filter it plans it with. */
export interface CopyUnit {
	dir: string;
	keep: CopyFilter;
}

interface Plan {
	/** The folder links are judged against: the one copied, or a target copied in a link's place. */
	unit: string;
	/** Where `unit` lands, below the destination. */
	at: string;
	root: string;
	local: boolean;
	keep: CopyFilter;
	steps: CopyStep[];
	/** Whether a link elsewhere in a clone is copied in its place: never inside such a copy. */
	materialises: boolean;
}

/**
 * Plans copying the folder `dir`, kept by `keep`, without following a link.
 * Folders and regular files copy; sockets, FIFOs and devices are left out. A
 * link, read from where it sits:
 * - out of the source root throws {@link SymlinkEscapeError};
 * - to something inside `dir` the filter keeps stays a link, made relative;
 * - to something inside `dir` the filter drops, or below a folder it drops,
 *   is left out;
 * - to `dir` itself or above it is an absolute link into a local source,
 *   which stays, and is left out of a clone, which is deleted once copied;
 * - elsewhere in the source is an absolute link into a local source, and in
 *   a clone is replaced by a copy of what it leads to (see {@link materialise}).
 *
 * The filter sees every path where it lands in the copy, so what a link
 * brings in is filtered as if it sat at the link's path.
 */
export async function planCopy(
	{ dir, keep }: CopyUnit,
	{ root, local }: CopySource,
): Promise<CopyStep[]> {
	const unit = resolve(dir);
	const plan: Plan = {
		unit,
		at: "",
		root: resolve(root),
		local,
		keep,
		steps: [],
		materialises: true,
	};
	plan.steps.push({ kind: "dir", path: "" });
	await planFolder(plan, unit, "");
	return plan.steps;
}

/** Writes a planned copy below `dest`, which holds nothing of it yet. */
export async function writeCopy(
	steps: CopyStep[],
	dest: string,
): Promise<void> {
	for (const step of steps) {
		const path = join(dest, step.path);
		if (step.kind === "dir") {
			await mkdir(path, { recursive: true });
		} else if (step.kind === "file") {
			await copyFile(step.from, path);
		} else {
			await symlink(step.target, path);
		}
	}
}

async function planFolder(
	plan: Plan,
	folder: string,
	dest: string,
): Promise<void> {
	for (const entry of await readdir(folder, { withFileTypes: true })) {
		const path = dest === "" ? entry.name : `${dest}/${entry.name}`;
		const from = join(folder, entry.name);
		if (!plan.keep(path)) {
			continue;
		}
		if (entry.isSymbolicLink()) {
			await planLink(plan, from, path);
		} else if (entry.isDirectory()) {
			plan.steps.push({ kind: "dir", path });
			await planFolder(plan, from, path);
		} else if (entry.isFile()) {
			plan.steps.push({ kind: "file", path, from });
		}
	}
}

/** Plans what the link at `path` in the copy is written as, if anything. */
async function planLink(plan: Plan, link: string, path: string): Promise<void> {
	const target = await containedTarget(link, plan.root);
	if (target !== plan.unit && isContained(plan.unit, target)) {
		const inside = posix.join(plan.at, relativePosix(plan.unit, target));
		if (keepsTheWay(plan.keep, inside)) {
			const relativeTarget = relative(dirname(link), target) || ".";
			plan.steps.push({ kind: "link", path, target: relativeTarget });
		}
	} else if (plan.local) {
		plan.steps.push({ kind: "link", path, target });
	} else if (plan.materialises && !isContained(target, plan.unit)) {
		await materialise(plan, target, path);
	}
}

/**
 * Whether the filter keeps a path and every folder above it, as a copy only
 * reaches what lies in the folders it keeps.
 */
function keepsTheWay(keep: CopyFilter, path: string): boolean {
	const names = path.split("/");
	return names.every((_, index) => keep(names.slice(0, index + 1).join("/")));
}

/**
 * Copies what a link elsewhere in a clone leads to in the link's place: a
 * regular file, or a folder whose own links are judged against it and are
 * never copied in their turn, so a chain or a cycle of links stops there.
 * A target in `.git`, itself a link or below one, not named as listed on
 * disk, or neither a file nor a folder is left out.
 */
async function materialise(
	plan: Plan,
	target: string,
	path: string,
): Promise<void> {
	const entry = await listedEntry(plan.root, target);
	if (entry?.isDirectory()) {
		plan.steps.push({ kind: "dir", path });
		const inner = { ...plan, unit: target, at: path, materialises: false };
		await planFolder(inner, target, path);
	} else if (entry?.isFile()) {
		plan.steps.push({ kind: "file", path, from: target });
	}
}

/**
 * The entry `target` names below `root`, when it's out of `.git`, each name
 * on the way to it is listed in its folder exactly as written, and every
 * folder on the way is a real one; null otherwise. Exact names keep the checks
 * made on the target's path true of what is read where a filesystem ignores
 * case: `SKILLS` there would read the folder above the item, and `.GIT` the
 * clone's history.
 */
async function listedEntry(
	root: string,
	target: string,
): Promise<Dirent | null> {
	const path = relativePosix(root, target);
	if (inGitFolder(path)) {
		return null;
	}
	let folder = root;
	let entry: Dirent | null = null;
	for (const name of path.split("/")) {
		if (entry !== null && !entry.isDirectory()) {
			return null;
		}
		const entries = await readdir(folder, { withFileTypes: true });
		entry = entries.find((listed) => listed.name === name) ?? null;
		if (entry === null) {
			return null;
		}
		folder = join(folder, name);
	}
	return entry;
}
