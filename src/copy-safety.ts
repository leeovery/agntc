import type { Stats } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readlink,
	realpath,
	stat,
	symlink,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	posix,
	relative,
	resolve,
} from "node:path";
import { isNodeError } from "./errors.js";
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
 * The symlink-escape pre-flight: plans copying all of `unitDir`, dropping the
 * plan, so it refuses every link the copy would follow out of `cloneRoot`,
 * including one inside a folder elsewhere in the clone that a link leads to.
 * Read-only.
 */
export async function scanForEscapingSymlinks(
	unitDir: string,
	cloneRoot: string,
): Promise<void> {
	await planCopy(unitDir, cloneRoot);
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

/** One thing a copy writes, at a `/`-joined path below its destination; "" is the destination. */
export type CopyStep =
	| { kind: "dir"; path: string }
	| { kind: "file"; path: string; from: string }
	| { kind: "link"; path: string; target: string };

/** Whether a copy writes what lands at a `/`-joined path below its destination. */
export type CopyFilter = (path: string) => boolean;

/** A folder copied whole, and where in the destination it lands. */
interface Frame {
	source: string;
	dest: string;
}

interface Planner {
	/** The clone as given and as resolved: a link may name it either way. */
	cloneRoot: string;
	realRoot: string;
	/** What is being copied, which links are named from. */
	unit: string;
	keep: CopyFilter;
	steps: CopyStep[];
}

/**
 * Plans copying `source` (a folder, a file or a link) so the copy never leads
 * back into the source, which for a remote item is a temp clone deleted once
 * copied. Nothing outside `cloneRoot` is read. A link:
 * - out of the clone, or through a link that leads out of it, throws
 *   {@link SymlinkEscapeError};
 * - to something copied anyway (inside a folder being copied, or that folder
 *   or one above it) stays a link, made relative;
 * - to anything else in the clone is replaced by what it points at, copied by
 *   these same rules. Folders are copied in place only when they hold nothing
 *   being copied, so cycles end;
 * - dangling, to nothing copied, is left out.
 * Sockets, FIFOs and devices are left out: copying one could block or never end.
 */
export async function planCopy(
	source: string,
	cloneRoot: string,
	keep: CopyFilter = () => true,
): Promise<CopyStep[]> {
	const planner: Planner = {
		cloneRoot: resolve(cloneRoot),
		realRoot: await realpath(cloneRoot),
		unit: await realLocation(source),
		keep,
		steps: [],
	};
	await planTarget(planner, [], source, await lstat(source), "");
	return planner.steps;
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

type EntryKind = Pick<Stats, "isDirectory" | "isFile" | "isSymbolicLink">;

async function planTarget(
	planner: Planner,
	frames: Frame[],
	source: string,
	kind: EntryKind,
	dest: string,
): Promise<void> {
	if (kind.isDirectory()) {
		const folder = await realpath(source);
		await planFolder(
			planner,
			[...frames, { source: folder, dest }],
			folder,
			dest,
		);
	} else {
		await planEntry(planner, frames, source, kind, dest);
	}
}

async function planFolder(
	planner: Planner,
	frames: Frame[],
	dir: string,
	dest: string,
): Promise<void> {
	planner.steps.push({ kind: "dir", path: dest });
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = dest === "" ? entry.name : `${dest}/${entry.name}`;
		if (planner.keep(path)) {
			await planEntry(planner, frames, join(dir, entry.name), entry, path);
		}
	}
}

async function planEntry(
	planner: Planner,
	frames: Frame[],
	source: string,
	kind: EntryKind,
	dest: string,
): Promise<void> {
	if (kind.isSymbolicLink()) {
		await planLink(planner, frames, source, dest);
	} else if (kind.isDirectory()) {
		await planFolder(planner, frames, source, dest);
	} else if (kind.isFile()) {
		planner.steps.push({ kind: "file", path: dest, from: source });
	}
}

async function planLink(
	planner: Planner,
	frames: Frame[],
	link: string,
	dest: string,
): Promise<void> {
	const { lexical, real } = await resolveInClone(planner, link);
	const at = copiedAt(planner.keep, frames, real ?? lexical);
	if (at !== undefined) {
		const target = relativeLink(posix.dirname(dest), at);
		planner.steps.push({ kind: "link", path: dest, target });
	} else if (real !== null) {
		await planTarget(planner, frames, real, await stat(real), dest);
	}
}

/**
 * Where a link leads, as written and, unless it dangles, as resolved. One
 * leading out of the clone, directly or through another link, is refused.
 */
async function resolveInClone(
	planner: Planner,
	link: string,
): Promise<{ lexical: string; real: string | null }> {
	const location = await realLocation(link);
	const written = await readlink(link);
	const lexical = resolve(dirname(location), written);
	const inside = inClone(planner, lexical);
	const real = inside ? await realpathOrNull(link) : null;
	if (!inside || (real !== null && !isContained(planner.realRoot, real))) {
		throw new SymlinkEscapeError(
			relative(planner.unit, location) || basename(location),
			written,
		);
	}
	return { lexical, real };
}

/**
 * Where a link's target lands in the copy when it's copied anyway: inside a
 * folder being copied and kept, or that folder or one above it.
 */
function copiedAt(
	keep: CopyFilter,
	frames: Frame[],
	target: string,
): string | undefined {
	for (const frame of [...frames].reverse()) {
		const at = posix.join(frame.dest, relativePosix(frame.source, target));
		if (isContained(target, frame.source)) {
			return at;
		}
		if (isContained(frame.source, target)) {
			return keep(at) ? at : undefined;
		}
	}
	return undefined;
}

/**
 * The link from folder `from` to `to`, both below the destination, where `to`
 * may climb above it. `posix.relative` would resolve both against the working
 * directory, which a deep enough climb runs out of.
 */
function relativeLink(from: string, to: string): string {
	const fromParts = segments(from);
	const toParts = segments(to);
	let shared = 0;
	while (shared < fromParts.length && fromParts[shared] === toParts[shared]) {
		shared += 1;
	}
	const ups = fromParts.slice(shared).map(() => "..");
	return [...ups, ...toParts.slice(shared)].join("/") || ".";
}

function segments(path: string): string[] {
	return path.split("/").filter((part) => part !== "" && part !== ".");
}

function inClone(planner: Planner, path: string): boolean {
	return (
		isContained(planner.realRoot, path) || isContained(planner.cloneRoot, path)
	);
}

/** A path with its folder resolved, the entry itself left as it is. */
async function realLocation(path: string): Promise<string> {
	return join(await realpath(dirname(path)), basename(path));
}

async function realpathOrNull(link: string): Promise<string | null> {
	try {
		return await realpath(link);
	} catch (err) {
		if (isNodeError(err) && DANGLING.has(err.code ?? "")) {
			return null;
		}
		throw err;
	}
}

const DANGLING = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);
