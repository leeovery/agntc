import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { validRange } from "semver";
import { assertSubpathWithinClone, PathTraversalError } from "./copy-safety.js";

interface GitHubShorthandSource {
	type: "github-shorthand";
	owner: string;
	repo: string;
	ref: string | null;
	constraint: string | null;
	manifestKey: string;
	cloneUrl: string;
}

interface HttpsUrlSource {
	type: "https-url";
	owner: string;
	repo: string;
	ref: string | null;
	constraint: string | null;
	manifestKey: string;
	cloneUrl: string;
}

interface SshUrlSource {
	type: "ssh-url";
	owner: string;
	repo: string;
	ref: string | null;
	constraint: string | null;
	manifestKey: string;
	cloneUrl: string;
}

interface DirectPathSource {
	type: "direct-path";
	owner: string;
	repo: string;
	ref: string;
	constraint: null;
	targetPlugin: string;
	manifestKey: string;
	cloneUrl: string;
}

interface LocalPathSource {
	type: "local-path";
	resolvedPath: string;
	ref: null;
	constraint: null;
	manifestKey: string;
}

export type ParsedSource =
	| GitHubShorthandSource
	| HttpsUrlSource
	| SshUrlSource
	| DirectPathSource
	| LocalPathSource;

function isLocalPath(input: string): boolean {
	return (
		input.startsWith("./") ||
		input.startsWith("../") ||
		input.startsWith("/") ||
		input.startsWith("~") ||
		input === "." ||
		input === ".."
	);
}

export async function parseSource(raw: string): Promise<ParsedSource> {
	const trimmed = raw.trim();

	if (trimmed === "") {
		throw new Error("source cannot be empty");
	}

	let result: ParsedSource;

	if (isLocalPath(trimmed)) {
		result = await parseLocalPath(trimmed);
	} else if (trimmed.startsWith("https://")) {
		const withoutProtocol = trimmed.slice("https://".length);
		if (hasTreePath(withoutProtocol)) {
			result = parseDirectPath(trimmed);
		} else {
			result = parseHttpsUrl(trimmed);
		}
	} else if (trimmed.startsWith("git@")) {
		result = parseSshUrl(trimmed);
	} else {
		result = parseGitHubShorthand(trimmed);
	}

	if (result.constraint !== null) {
		validateConstraint(result.constraint);
	}

	return result;
}

async function parseLocalPath(input: string): Promise<LocalPathSource> {
	let expanded = input;
	if (expanded.startsWith("~")) {
		expanded = homedir() + expanded.slice(1);
	}

	const resolvedPath = resolve(expanded);

	try {
		const stats = await stat(resolvedPath);
		if (!stats.isDirectory()) {
			throw new Error(
				`Path ${resolvedPath} does not exist or is not a directory`,
			);
		}
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("Path ")) {
			throw err;
		}
		throw new Error(
			`Path ${resolvedPath} does not exist or is not a directory`,
		);
	}

	return {
		type: "local-path",
		resolvedPath,
		ref: null,
		constraint: null,
		manifestKey: resolvedPath,
	};
}

function hasTreePath(withoutProtocol: string): boolean {
	// Check if the path portion (after the host) contains /tree/
	const slashIndex = withoutProtocol.indexOf("/");
	if (slashIndex === -1) return false;
	const pathPart = withoutProtocol.slice(slashIndex);
	return pathPart.includes("/tree/") || pathPart.endsWith("/tree/");
}

function parseDirectPath(input: string): DirectPathSource {
	const withoutProtocol = input.slice("https://".length);
	const slashIndex = withoutProtocol.indexOf("/");
	const host = withoutProtocol.slice(0, slashIndex);
	const rawPath = withoutProtocol.slice(slashIndex + 1);

	// Reject @ref suffix on tree URLs — only check the path after the hostname,
	// so that authenticated URLs (e.g., https://user@host/...) are not rejected.
	if (rawPath.includes("@")) {
		throw new Error("tree URLs cannot have @ref suffix");
	}

	// Split on /tree/ to get owner/repo prefix and ref/plugin suffix
	const treeIndex = rawPath.indexOf("/tree/");
	const ownerRepoPath = rawPath.slice(0, treeIndex);
	const afterTree = rawPath
		.slice(treeIndex + "/tree/".length)
		.replace(/\/+$/, "");

	// Parse owner/repo
	const ownerRepoSegments = ownerRepoPath.split("/").filter((s) => s !== "");
	if (ownerRepoSegments.length < 2) {
		throw new Error(
			`invalid tree URL: expected owner/repo before /tree/, got "${ownerRepoPath}"`,
		);
	}
	const owner = ownerRepoSegments[0]!;
	const repo = ownerRepoSegments[1]!;

	// Parse ref (first segment) and plugin (rest)
	const afterTreeSegments = afterTree.split("/").filter((s) => s !== "");

	if (afterTreeSegments.length === 0) {
		throw new Error("invalid tree URL: missing ref and plugin path");
	}

	if (afterTreeSegments.length === 1) {
		throw new Error("invalid tree URL: missing plugin path after ref");
	}

	const ref = afterTreeSegments[0]!;
	const targetPlugin = afterTreeSegments.slice(1).join("/");

	const cloneUrl = `https://${host}/${owner}/${repo}.git`;
	const manifestKey = `${owner}/${repo}/${targetPlugin}`;

	return {
		type: "direct-path",
		owner,
		repo,
		ref,
		constraint: null,
		targetPlugin,
		manifestKey,
		cloneUrl,
	};
}

function parseSshUrl(input: string): SshUrlSource {
	const withoutPrefix = input.slice("git@".length);

	const colonIndex = withoutPrefix.indexOf(":");
	if (colonIndex === -1) {
		throw new Error(
			`invalid SSH URL: expected git@host:owner/repo format, got "${input}"`,
		);
	}

	const host = withoutPrefix.slice(0, colonIndex);
	const afterColon = withoutPrefix.slice(colonIndex + 1);

	if (afterColon === "") {
		throw new Error(`invalid SSH URL: missing owner/repo path in "${input}"`);
	}

	let pathPart: string;
	let ref: string | null = null;

	const dotGitIndex = afterColon.indexOf(".git");
	if (dotGitIndex !== -1) {
		const afterDotGit = afterColon.slice(dotGitIndex + ".git".length);
		pathPart = afterColon.slice(0, dotGitIndex);

		if (afterDotGit.startsWith("@")) {
			ref = afterDotGit.slice(1);
			if (ref === "") {
				throw new Error("ref cannot be empty when @ is present");
			}
		}
	} else {
		const atIndex = afterColon.indexOf("@");
		if (atIndex !== -1) {
			pathPart = afterColon.slice(0, atIndex);
			ref = afterColon.slice(atIndex + 1);
			if (ref === "") {
				throw new Error("ref cannot be empty when @ is present");
			}
		} else {
			pathPart = afterColon;
		}
	}

	const segments = pathPart.split("/").filter((s) => s !== "");

	if (segments.length < 2) {
		throw new Error(
			`invalid SSH URL: expected owner/repo path, got "${pathPart}"`,
		);
	}

	const owner = segments[0]!;
	const repo = segments[1]!;
	const cloneUrl = `git@${host}:${owner}/${repo}.git`;

	const { ref: finalRef, constraint } = classifyRefOrConstraint(ref);

	return {
		type: "ssh-url",
		owner,
		repo,
		ref: finalRef,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl,
	};
}

function parseHttpsUrl(input: string): HttpsUrlSource {
	const withoutProtocol = input.slice("https://".length);
	const { urlPart: rawUrlPart, ref: rawRef } = extractRef(withoutProtocol);

	const urlPart = rawUrlPart.replace(/\/+$/, "");

	const slashIndex = urlPart.indexOf("/");
	if (slashIndex === -1) {
		throw new Error(
			`invalid HTTPS URL: no path segments in "https://${urlPart}"`,
		);
	}

	const host = urlPart.slice(0, slashIndex);
	const pathPart = urlPart.slice(slashIndex + 1).replace(/\.git$/, "");

	const segments = pathPart.split("/").filter((s) => s !== "");

	if (segments.length < 2) {
		throw new Error(
			`invalid HTTPS URL: expected owner/repo path, got "${pathPart}"`,
		);
	}

	const owner = segments[segments.length - 2]!;
	const repo = segments[segments.length - 1]!;
	const cloneUrl = `https://${host}/${owner}/${repo}.git`;

	const { ref, constraint } = classifyRefOrConstraint(rawRef);

	return {
		type: "https-url",
		owner,
		repo,
		ref,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl,
	};
}

function extractRef(input: string): { urlPart: string; ref: string | null } {
	const atIndex = input.indexOf("@");

	if (atIndex === -1) {
		return { urlPart: input, ref: null };
	}

	const ref = input.slice(atIndex + 1);
	if (ref === "") {
		throw new Error("ref cannot be empty when @ is present");
	}

	return { urlPart: input.slice(0, atIndex), ref };
}

function validateConstraint(constraint: string): void {
	if (validRange(constraint) === null) {
		throw new Error(`invalid version constraint: ${constraint}`);
	}
}

function isConstraintPrefix(suffix: string): boolean {
	return suffix.startsWith("^") || suffix.startsWith("~");
}

function classifyRefOrConstraint(rawRef: string | null): {
	ref: string | null;
	constraint: string | null;
} {
	if (rawRef !== null && isConstraintPrefix(rawRef)) {
		return { ref: null, constraint: rawRef };
	}
	return { ref: rawRef, constraint: null };
}

function parseGitHubShorthand(input: string): GitHubShorthandSource {
	const [pathPart, ...refParts] = input.split("@");
	const rawRef = refParts.length > 0 ? refParts.join("@") : null;

	if (rawRef === "") {
		throw new Error("ref cannot be empty when @ is present");
	}

	const segments = pathPart!.split("/");

	if (segments.length === 1) {
		throw new Error(`source must be in owner/repo format, got "${pathPart}"`);
	}

	if (segments.length > 2) {
		throw new Error(
			`too many slashes in source "${pathPart}" — expected owner/repo`,
		);
	}

	const [owner, repo] = segments as [string, string];

	if (owner === "") {
		throw new Error("owner cannot be empty");
	}

	if (repo === "") {
		throw new Error("repo cannot be empty");
	}

	const { ref, constraint } = classifyRefOrConstraint(rawRef);

	return {
		type: "github-shorthand",
		owner,
		repo,
		ref,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `https://github.com/${owner}/${repo}.git`,
	};
}

export function buildParsedSourceFromKey(
	key: string,
	ref: string | null,
	cloneUrl: string | null,
): ParsedSource {
	const parts = key.split("/");
	const owner = parts[0]!;
	const repo = parts[1]!;

	if (cloneUrl !== null) {
		return {
			type: "https-url",
			owner,
			repo,
			ref,
			constraint: null,
			manifestKey: `${owner}/${repo}`,
			cloneUrl,
		};
	}

	return {
		type: "github-shorthand",
		owner,
		repo,
		ref,
		constraint: null,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `https://github.com/${owner}/${repo}.git`,
	};
}

/**
 * The bare `owner/repo` a manifest key installs from — its first two segments.
 * A key is `owner/repo` for a standalone entry or `owner/repo/<member>` for a
 * collection member; the repo is the first two segments either way, so any
 * `/<member>` suffix is stripped. The single home of this key→repo transform.
 */
export function repoFromKey(key: string): string {
	return key.split("/").slice(0, 2).join("/");
}

/**
 * The member basename of a manifest key — its last `/`-segment. For a
 * standalone `owner/repo` key this is the repo name; for a collection member
 * `owner/repo/<member>` it is `<member>`. The single home of this key→basename
 * transform.
 */
export function memberName(key: string): string {
	return key.split("/").pop()!;
}

export function resolveCloneUrl(parsed: ParsedSource): string {
	if (parsed.type === "local-path") {
		throw new Error("Cannot resolve clone URL for local path source");
	}
	return parsed.cloneUrl;
}

export function deriveCloneUrlFromKey(
	key: string,
	cloneUrl: string | null,
): string {
	if (cloneUrl !== null) {
		return cloneUrl;
	}
	const parts = key.split("/");
	const owner = parts[0]!;
	const repo = parts[1]!;
	return `https://github.com/${owner}/${repo}.git`;
}

export function getSourceDirFromKey(tempDir: string, key: string): string {
	const parts = key.split("/");
	if (parts.length > 2) {
		const subPath = parts.slice(2).join("/");
		return join(tempDir, subPath);
	}
	return tempDir;
}

/**
 * Resolves the source dir of a re-cloned tree for an update. The single
 * authoring of the cycle-9 rule: PREFER the entry's recorded `sourceSubpath`
 * (a skills-only collection member keyed by basename lives at
 * `<clone>/skills/<name>`, not the key-derived `<clone>/<name>`); fall back to
 * the unchanged key-derived dir when no subpath was recorded (root-child
 * members and standalone entries round-trip exactly as before). Shared by
 * `cloneAndReinstall` and the integration tests so the rule and its tests
 * cannot drift.
 */
export function resolveUpdateSourceDir(
	cloneRoot: string,
	key: string,
	sourceSubpath: string | undefined,
): string {
	return sourceSubpath
		? join(cloneRoot, sourceSubpath)
		: getSourceDirFromKey(cloneRoot, key);
}

/**
 * The single home of the per-member path-traversal containment guard paired
 * with source-dir resolution — composed by BOTH clone entry points
 * (`cloneAndReinstall`'s remote branch and the group orchestrator's
 * `reinstallMember`). This is a security invariant (symlink / `../` escape
 * rejection), a preservation constraint rather than a design choice; authoring
 * it once here means a future change to the escape rule or its error mapping
 * provably reaches both entry points instead of silently leaving one unguarded.
 *
 * It runs the lexical guard ({@link assertSubpathWithinClone}) against the whole
 * clone root, then discriminates the outcome: a {@link PathTraversalError} is
 * narrowed to `{ ok: false, message }` (the error's message verbatim, for the
 * caller's clean clone-failed pre-flight abort — no nuke, no copy, install
 * intact), while ANY other error RETHROWS unchanged (never swallowed as a
 * failure result). On success it returns `{ ok: true, sourceDir }` resolved via
 * {@link resolveUpdateSourceDir}. The guard is a no-op when `sourceSubpath` is
 * absent (the key-derived fallback), so standalone entries and root-child
 * members round-trip exactly as before. Co-located with
 * {@link resolveUpdateSourceDir} — the source-dir authority both callers already
 * use — to keep the guard sequence in exactly one place.
 */
export function resolveGuardedSourceDir(
	cloneRoot: string,
	key: string,
	sourceSubpath: string | undefined,
): { ok: true; sourceDir: string } | { ok: false; message: string } {
	if (sourceSubpath) {
		try {
			assertSubpathWithinClone(cloneRoot, sourceSubpath);
		} catch (err) {
			if (err instanceof PathTraversalError) {
				return { ok: false, message: err.message };
			}
			throw err;
		}
	}

	return {
		ok: true,
		sourceDir: resolveUpdateSourceDir(cloneRoot, key, sourceSubpath),
	};
}
