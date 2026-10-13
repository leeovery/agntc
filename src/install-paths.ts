import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "./errors.js";

/**
 * `.claude` and `.claude/<asset>` are shared by every install, and a user may
 * link them, so only the paths below them, which an item owns, are guarded.
 */
const SHARED_DEPTH = 2;

/** What an install-root-relative path holds, found without following a link. */
export type InstallPathState =
	| { kind: "missing" }
	/** A symlink at the path itself, or at a folder an item owns above it. */
	| { kind: "link"; at: string }
	| { kind: "present"; isDirectory: boolean };

const MISSING: InstallPathState = { kind: "missing" };

/** Drops a trailing slash, which would make `lstat` follow a link. */
export function withoutTrailingSlash(path: string): string {
	return path.replace(/\/+$/, "");
}

/** A single folder or file name: not empty, `.` or `..`, and holding no `/`. */
export function isSafeSegment(name: string): boolean {
	return name !== "" && name !== "." && name !== ".." && !name.includes("/");
}

/**
 * A relative path made only of safe segments, a trailing slash aside, so it
 * can only name something strictly below the root it's joined to.
 */
export function isContainedPath(relPath: string): boolean {
	return withoutTrailingSlash(relPath).split("/").every(isSafeSegment);
}

/**
 * Walks an install path with `lstat` from the first folder an item owns down
 * to the path itself, stopping at the first symlink or missing component, so
 * no link is ever followed and a dangling one is still found.
 */
export async function inspectInstallPath(
	projectDir: string,
	relPath: string,
): Promise<InstallPathState> {
	let state = MISSING;
	for (const owned of ownedPaths(relPath)) {
		const stats = await lstatOrNull(join(projectDir, owned));
		if (stats === null) {
			return MISSING;
		}
		if (stats.isSymbolicLink()) {
			return { kind: "link", at: owned };
		}
		state = { kind: "present", isDirectory: stats.isDirectory() };
	}
	return state;
}

/**
 * Refuses to write an item's target through a symlink, whether at the target,
 * at a folder the item owns above it, or inside a folder already there.
 */
export async function assertNoLinkInTheWay(
	projectDir: string,
	target: string,
): Promise<void> {
	const link = await findLinkInTheWay(projectDir, target);
	if (link !== null) {
		throw new Error(`${link} is a symlink — agntc won't write through it`);
	}
}

async function findLinkInTheWay(
	projectDir: string,
	target: string,
): Promise<string | null> {
	const state = await inspectInstallPath(projectDir, target);
	if (state.kind === "link") {
		return state.at;
	}
	if (state.kind === "present" && state.isDirectory) {
		return findLinkWithin(projectDir, withoutTrailingSlash(target));
	}
	return null;
}

async function findLinkWithin(
	projectDir: string,
	folder: string,
): Promise<string | null> {
	const entries = await readdir(join(projectDir, folder), {
		withFileTypes: true,
	});
	for (const entry of entries) {
		const path = `${folder}/${entry.name}`;
		if (entry.isSymbolicLink()) {
			return path;
		}
		const inner = entry.isDirectory()
			? await findLinkWithin(projectDir, path)
			: null;
		if (inner !== null) {
			return inner;
		}
	}
	return null;
}

/** The path and each folder above it that an item owns, outermost first. */
function ownedPaths(relPath: string): string[] {
	const segments = withoutTrailingSlash(relPath).split("/");
	const first = Math.min(SHARED_DEPTH, segments.length - 1);
	return segments
		.map((_, index) => segments.slice(0, index + 1).join("/"))
		.slice(first);
}

async function lstatOrNull(path: string): Promise<Stats | null> {
	try {
		return await lstat(path);
	} catch (err) {
		if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
			return null;
		}
		throw err;
	}
}
