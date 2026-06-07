import { readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Pure lexical containment predicate: does `candidate` resolve at or below
 * `root`? Boundary-correct (relative()-based, never startsWith) so sibling
 * directories sharing a prefix (`/clone` vs `/clone-evil`) are NOT contained.
 * No filesystem access.
 */
function isContained(root: string, candidate: string): boolean {
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
 * `unitDir` is the tree to copy (bare-skill dir, plugin/unit dir, or member
 * subdir); `cloneRoot` is the containment boundary. A symlink may legitimately
 * point anywhere inside the clone (e.g. a sibling unit dir in a multi-dir
 * plugin), so the boundary is the clone root, NOT the unit dir.
 *
 * Symlinks are detected (dirent.isSymbolicLink) but never followed: symlinked
 * directories are validated and NOT descended into, so symlink-to-dir cycles
 * (a link to an ancestor) cannot be traversed and the walk visits only the
 * finite real directory tree. Recursion descends into REAL subdirectories at
 * any depth.
 *
 * Target containment is evaluated LEXICALLY via path.resolve (no realpath/stat
 * on the target): this both implements the spec's broken-link semantics
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
			await assertSymlinkContained(entryPath, cloneRoot, unitRoot);
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

async function assertSymlinkContained(
	linkPath: string,
	cloneRoot: string,
	unitRoot: string,
): Promise<void> {
	const target = await readlink(linkPath);
	// Resolve relative + absolute targets against the link's directory
	// (absolute targets ignore the base). lexical against clone root — no
	// realpath/stat, so broken links are judged by the same predicate.
	const resolvedTarget = resolve(dirname(linkPath), target);

	if (!isContained(cloneRoot, resolvedTarget)) {
		const relPath = relative(unitRoot, linkPath);
		throw new SymlinkEscapeError(relPath, target);
	}
}
