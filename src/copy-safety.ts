import { isAbsolute, relative, resolve } from "node:path";

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

	const root = resolve(cloneRoot);
	const resolved = resolve(cloneRoot, subpath);
	const rel = relative(root, resolved);
	const contained = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));

	if (!contained) {
		throw new PathTraversalError(subpath);
	}
}
