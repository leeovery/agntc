import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validRange } from "semver";
import { assertSubpathWithinClone, PathTraversalError } from "./copy-safety.js";

interface RemoteSource {
	owner: string;
	repo: string;
	ref: string | null;
	constraint: string | null;
	manifestKey: string;
	cloneUrl: string;
	/** Repo-relative folder the discovery walk starts at; absent for the root. */
	startPath?: string;
}

interface GitHubShorthandSource extends RemoteSource {
	type: "github-shorthand";
}

interface HttpsUrlSource extends RemoteSource {
	type: "https-url";
}

interface SshUrlSource extends RemoteSource {
	type: "ssh-url";
}

interface TreeUrlSource extends RemoteSource {
	type: "tree-url";
	ref: string;
	constraint: null;
	startPath: string;
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
	| TreeUrlSource
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
			result = parseTreeUrl(trimmed);
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

/**
 * A local source is the real folder the path leads to, so a linked folder
 * installs and is keyed as the folder it links to.
 */
async function parseLocalPath(input: string): Promise<LocalPathSource> {
	const expanded = input.startsWith("~") ? homedir() + input.slice(1) : input;
	const path = resolve(expanded);
	const resolvedPath = await realDirectory(path);
	if (resolvedPath === null) {
		throw new Error(`Path ${path} does not exist or is not a directory`);
	}

	return {
		type: "local-path",
		resolvedPath,
		ref: null,
		constraint: null,
		manifestKey: resolvedPath,
	};
}

async function realDirectory(path: string): Promise<string | null> {
	try {
		const real = await realpath(path);
		return (await stat(real)).isDirectory() ? real : null;
	} catch {
		return null;
	}
}

function hasTreePath(withoutProtocol: string): boolean {
	// Check if the path portion (after the host) contains /tree/
	const slashIndex = withoutProtocol.indexOf("/");
	if (slashIndex === -1) return false;
	const pathPart = withoutProtocol.slice(slashIndex);
	return pathPart.includes("/tree/") || pathPart.endsWith("/tree/");
}

function parseTreeUrl(input: string): TreeUrlSource {
	const withoutProtocol = input.slice("https://".length);
	const slashIndex = withoutProtocol.indexOf("/");
	const host = withoutProtocol.slice(0, slashIndex);
	const rawPath = withoutProtocol.slice(slashIndex + 1);

	// Reject @ref suffix on tree URLs — only check the path after the hostname,
	// so that authenticated URLs (e.g., https://user@host/...) are not rejected.
	if (rawPath.includes("@")) {
		throw new Error("tree URLs cannot have @ref suffix");
	}

	const treeIndex = rawPath.indexOf("/tree/");
	const ownerRepoPath = rawPath.slice(0, treeIndex);
	const afterTree = rawPath
		.slice(treeIndex + "/tree/".length)
		.replace(/\/+$/, "");

	const ownerRepoSegments = ownerRepoPath.split("/").filter((s) => s !== "");
	if (ownerRepoSegments.length < 2) {
		throw new Error(
			`invalid tree URL: expected owner/repo before /tree/, got "${ownerRepoPath}"`,
		);
	}
	const owner = ownerRepoSegments[0]!;
	const repo = ownerRepoSegments[1]!;

	const afterTreeSegments = afterTree.split("/").filter((s) => s !== "");

	if (afterTreeSegments.length === 0) {
		throw new Error("invalid tree URL: missing ref and path");
	}

	if (afterTreeSegments.length === 1) {
		throw new Error("invalid tree URL: missing path after ref");
	}

	return {
		type: "tree-url",
		owner,
		repo,
		ref: afterTreeSegments[0]!,
		constraint: null,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `https://${host}/${owner}/${repo}.git`,
		startPath: afterTreeSegments.slice(1).join("/"),
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

	const { urlPart: pathPart, ref: rawRef } = extractRef(afterColon);
	const repoPath = splitRepoPath(pathPart);

	if (repoPath === null) {
		throw new Error(
			`invalid SSH URL: expected owner/repo path, got "${pathPart}"`,
		);
	}

	const { owner, repo } = repoPath;
	const { ref, constraint } = classifyRefOrConstraint(rawRef);

	return {
		type: "ssh-url",
		...repoPath,
		ref,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `git@${host}:${owner}/${repo}.git`,
	};
}

function parseHttpsUrl(input: string): HttpsUrlSource {
	const withoutProtocol = input.slice("https://".length);

	// The host ends at the first `/`, so a login (`user@host`) stays in it and
	// only an `@` in the path starts the ref.
	const slashIndex = withoutProtocol.indexOf("/");
	if (slashIndex === -1) {
		throw new Error(
			`invalid HTTPS URL: no path segments in "https://${withoutProtocol}"`,
		);
	}

	const host = withoutProtocol.slice(0, slashIndex);
	const { urlPart: rawPathPart, ref: rawRef } = extractRef(
		withoutProtocol.slice(slashIndex + 1),
	);
	const pathPart = rawPathPart.replace(/\/+$/, "");
	const repoPath = splitRepoPath(pathPart);

	if (repoPath === null) {
		throw new Error(
			`invalid HTTPS URL: expected owner/repo path, got "${pathPart}"`,
		);
	}

	const { owner, repo } = repoPath;
	const { ref, constraint } = classifyRefOrConstraint(rawRef);

	return {
		type: "https-url",
		...repoPath,
		ref,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `https://${host}/${owner}/${repo}.git`,
	};
}

/**
 * A URL's `owner/repo[.git][/path]`: the first two segments name the repo and
 * the rest is the repo-relative start path, as in `owner/repo/path` shorthand.
 * Null when the owner or repo is missing.
 */
function splitRepoPath(
	pathPart: string,
): { owner: string; repo: string; startPath?: string } | null {
	const [owner, rawRepo = "", ...rest] = pathPart
		.split("/")
		.filter((s) => s !== "");
	const repo = rawRepo.replace(/\.git$/, "");
	if (owner === undefined || repo === "") {
		return null;
	}
	const startPath = rest.join("/");
	return { owner, repo, ...(startPath !== "" ? { startPath } : {}) };
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

	const [owner = "", repo, ...pathSegments] = pathPart!.split("/");

	if (repo === undefined) {
		throw new Error(
			`source must be in owner/repo[/path] format, got "${pathPart}"`,
		);
	}

	if (owner === "") {
		throw new Error("owner cannot be empty");
	}

	if (repo === "") {
		throw new Error("repo cannot be empty");
	}

	const { ref, constraint } = classifyRefOrConstraint(rawRef);
	const startPath = pathSegments.join("/").replace(/\/+$/, "");

	return {
		type: "github-shorthand",
		owner,
		repo,
		ref,
		constraint,
		manifestKey: `${owner}/${repo}`,
		cloneUrl: `https://github.com/${owner}/${repo}.git`,
		...(startPath !== "" ? { startPath } : {}),
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
 * A key is `owner/repo` for a standalone entry or `owner/repo/<member>` for an
 * entry from a multi-item repo; the repo is the first two segments either way, so any
 * `/<member>` suffix is stripped. The single home of this key→repo transform.
 */
export function repoFromKey(key: string): string {
	return key.split("/").slice(0, 2).join("/");
}

/**
 * The member basename of a manifest key — its last `/`-segment. For a
 * standalone `owner/repo` key this is the repo name; for an entry from a multi-item repo
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

/**
 * The folder a local entry was added from. A local key is that folder's path,
 * plus the item's name for an item recorded with a `sourceSubpath`.
 */
export function localSourceRoot(
	key: string,
	sourceSubpath: string | undefined,
): string {
	return sourceSubpath ? dirname(key) : key;
}

/** The repo-relative path a key spells after `owner/repo`; empty for the repo itself. */
export function keySubpath(key: string): string {
	return key.split("/").slice(2).join("/");
}

/**
 * The source `add` takes to reach a remote key's repo again: `owner/repo`
 * shorthand for GitHub over HTTPS (or no recorded clone URL), else the clone
 * URL without `.git`, which takes a path and version as shorthand does.
 */
export function addSourceFor(key: string, cloneUrl: string | null): string {
	const repo = repoFromKey(key);
	const url = cloneUrl?.replace(/\.git$/, "");
	return url === undefined || url === `https://github.com/${repo}` ? repo : url;
}

/** `source[/path][@version]`, the form `add` reads a start path and version in. */
export function locateSource(
	source: string,
	path: string,
	version?: string,
): string {
	const located = path === "" ? source : `${source}/${path}`;
	return version === undefined ? located : `${located}@${version}`;
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
 * failure result). On success it returns `{ ok: true, sourceDir }`: the
 * recorded `sourceSubpath` below the clone root, else the key's own suffix (a
 * skill keyed by name that lives at `<clone>/skills/<name>` records the
 * former). The guard covers whichever of the two the dir is read from, as a
 * hand-edited key could point outside the clone.
 */
export function resolveGuardedSourceDir(
	cloneRoot: string,
	key: string,
	sourceSubpath: string | undefined,
): GuardedSourceDir {
	return guardSourceDir(cloneRoot, sourceSubpath || keySubpath(key));
}

export type GuardedSourceDir =
	| { ok: true; sourceDir: string }
	| { ok: false; message: string };

/** `root/path`, unless `path` leads outside `root`. */
export function guardSourceDir(root: string, path: string): GuardedSourceDir {
	try {
		assertSubpathWithinClone(root, path);
	} catch (err) {
		if (err instanceof PathTraversalError) {
			return { ok: false, message: err.message };
		}
		throw err;
	}
	return { ok: true, sourceDir: join(root, path) };
}
