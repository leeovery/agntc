import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readlink,
	symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
 * Recursive pre-flight scan that rejects any symlink in `unitDir` whose target
 * resolves outside `cloneRoot` (the boundary). Read-only: no filesystem writes.
 *
 * `unitDir` is the tree to copy (bare-skill dir, pack dir, or member
 * subdir); `cloneRoot` is the containment boundary. A symlink may legitimately
 * point anywhere inside the clone (e.g. a sibling unit dir in a multi-dir
 * pack), so the boundary is the clone root, NOT the unit dir.
 *
 * Symlinks are detected (dirent.isSymbolicLink) but never followed: symlinked
 * directories are validated and NOT descended into, so symlink-to-dir cycles
 * (a link to an ancestor) cannot be traversed and the walk visits only the
 * finite real directory tree. Recursion descends into REAL subdirectories at
 * any depth.
 *
 * Target containment is evaluated LEXICALLY via path.resolve (no realpath/stat
 * on the target): this both implements broken-link semantics
 * (a dangling link is judged by where it points lexically) and avoids
 * following symlink chains. Throws {@link SymlinkEscapeError} on the FIRST
 * escaping symlink (fail fast). Pure: throw only, no logging or process.exit.
 */
export async function scanForEscapingSymlinks(
	unitDir: string,
	cloneRoot: string,
): Promise<void> {
	const root = resolve(cloneRoot);
	const unitRoot = resolve(unitDir);
	await scanDir(unitRoot, root, unitRoot);
}

async function scanDir(
	dir: string,
	cloneRoot: string,
	unitRoot: string,
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = join(dir, entry.name);

		if (entry.isSymbolicLink()) {
			await containedTarget(entryPath, cloneRoot, unitRoot);
			// Validated but NOT descended into — prevents infinite loops on
			// symlink-to-dir cycles (link to an ancestor).
			continue;
		}

		if (entry.isDirectory()) {
			await scanDir(entryPath, cloneRoot, unitRoot);
		}
	}
}

/**
 * Scan-and-narrow wrapper around {@link scanForEscapingSymlinks}: runs the
 * symlink-escape pre-flight and maps the outcome to a discriminated result so
 * callers own only their distinct surfacing. A {@link SymlinkEscapeError} is
 * narrowed to `{ ok: false, message }` (the error's message verbatim); any
 * other error RETHROWS unchanged. Success resolves to `{ ok: true }`. The
 * scan boundary semantics are unchanged — callers pass the same `unitDir` /
 * `cloneRoot` arguments they would to {@link scanForEscapingSymlinks}.
 */
export async function checkEscapingSymlinks(
	unitDir: string,
	cloneRoot: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
	try {
		await scanForEscapingSymlinks(unitDir, cloneRoot);
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
 * dangling link is judged the same way. One leading out of `cloneRoot` throws.
 */
async function containedTarget(
	linkPath: string,
	cloneRoot: string,
	unitRoot: string,
): Promise<string> {
	const written = await readlink(linkPath);
	const target = resolve(dirname(linkPath), written);
	if (!isContained(cloneRoot, target)) {
		throw new SymlinkEscapeError(relative(unitRoot, linkPath), written);
	}
	return target;
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

interface Plan {
	unit: string;
	root: string;
	local: boolean;
	keep: CopyFilter;
	steps: CopyStep[];
}

/**
 * Plans copying the folder `dir` without following a link. Folders and
 * regular files copy; sockets, FIFOs and devices are left out. A link, read
 * from where it sits:
 * - out of the source root throws {@link SymlinkEscapeError};
 * - to something inside `dir` the filter keeps stays a link, made relative;
 * - to something inside `dir` the filter drops is left out;
 * - to `dir` itself, above it or elsewhere in the source is an absolute link
 *   into a local source, which stays, and is left out of a clone, which is
 *   deleted once copied.
 */
export async function planCopy(
	dir: string,
	{ root, local }: CopySource,
	keep: CopyFilter,
): Promise<CopyStep[]> {
	const unit = resolve(dir);
	const plan: Plan = { unit, root: resolve(root), local, keep, steps: [] };
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
			const target = await installedLink(plan, from);
			if (target !== null) {
				plan.steps.push({ kind: "link", path, target });
			}
		} else if (entry.isDirectory()) {
			plan.steps.push({ kind: "dir", path });
			await planFolder(plan, from, path);
		} else if (entry.isFile()) {
			plan.steps.push({ kind: "file", path, from });
		}
	}
}

/** What a link is written as in the copy, or null when it's left out. */
async function installedLink(plan: Plan, link: string): Promise<string | null> {
	const target = await containedTarget(link, plan.root, plan.unit);
	const inside = relativePosix(plan.unit, target);
	if (inside === "" || !isContained(plan.unit, target)) {
		return plan.local ? target : null;
	}
	return plan.keep(inside) ? relative(dirname(link), target) || "." : null;
}
