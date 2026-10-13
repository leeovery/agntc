import { join } from "node:path";
import { isContained } from "./copy-safety.js";
import { relativePosix } from "./fs-utils.js";
import type { ManifestEntry } from "./manifest.js";
import { agntcCommand, type ScopeName } from "./scope.js";
import {
	addSourceFor,
	deriveCloneUrlFromKey,
	keySubpath,
	localSourceRoot,
	locateSource,
	memberName,
	repoFromKey,
} from "./source-parser.js";

/**
 * What makes two entries come from the same source. A local root is `exact`
 * when it is the recorded folder the source was added from, not one derived
 * from a key.
 */
export type SourceId =
	| { kind: "remote"; cloneUrl: string }
	| { kind: "local"; root: string; exact: boolean };

export function sourceIdOf(key: string, entry: ManifestEntry): SourceId {
	return entry.commit === null
		? {
				kind: "local",
				root: localRootOf(key, entry),
				exact: entry.localRoot !== undefined,
			}
		: { kind: "remote", cloneUrl: deriveCloneUrlFromKey(key, entry.cloneUrl) };
}

/**
 * Remote sources match on the repo their clone URLs name. Two exact local
 * roots match only when they are the same folder: a checkout nested inside
 * another is a source of its own. A derived root is the folder it was added
 * from only when the entry records a `sourceSubpath`; otherwise it is the
 * item's own folder, inside that source, so against a derived root either root
 * holding the other matches.
 */
export function isSameSource(a: SourceId, b: SourceId): boolean {
	if (a.kind === "remote") {
		return (
			b.kind === "remote" &&
			remoteRepoOf(a.cloneUrl) === remoteRepoOf(b.cloneUrl)
		);
	}
	if (b.kind !== "local") {
		return false;
	}
	if (a.exact && b.exact) {
		return a.root === b.root;
	}
	return isContained(a.root, b.root) || isContained(b.root, a.root);
}

const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * The repo a clone URL names, as `host/owner/repo`. Its protocol, login, port
 * and `.git` suffix don't change the repo, so `https://github.com/o/r.git` and
 * `git@github.com:o/r` name one. A URL without a host names itself.
 */
function remoteRepoOf(cloneUrl: string): string {
	const scheme = URL_SCHEME.exec(cloneUrl)?.[0];
	const rest = cloneUrl.slice(scheme?.length ?? 0);
	const hostEnd = rest.indexOf(scheme === undefined ? ":" : "/");
	if (hostEnd === -1) {
		return cloneUrl;
	}
	const host = rest
		.slice(0, hostEnd)
		.replace(/^.*@/, "")
		.replace(/:\d*$/, "")
		.toLowerCase();
	const repo = rest
		.slice(hostEnd + 1)
		.replace(/^\/+|\/+$/g, "")
		.replace(/\.git$/, "");
	return `${host}/${repo}`;
}

/** The folder a local entry was added from: recorded, or derived from its key. */
export function localRootOf(key: string, entry: ManifestEntry): string {
	return entry.localRoot ?? localSourceRoot(key, entry.sourceSubpath);
}

/** Where a local entry's item lives below `root`, its {@link localRootOf}. */
export function localItemPath(
	key: string,
	entry: ManifestEntry,
	root: string,
): string {
	return entry.sourceSubpath ?? localKeyPath(key, root);
}

/** Where a local key puts its item below `root`, a recorded path aside. */
function localKeyPath(key: string, root: string): string {
	return relativePosix(root, key);
}

/**
 * The key `add` gives the source an entry was added from, which its items are
 * keyed under: the `owner/repo` a remote key starts with, or a local entry's
 * folder ({@link localRootOf}).
 */
export function sourceKeyOf(key: string, entry: ManifestEntry): string {
	return entry.commit === null ? localRootOf(key, entry) : repoFromKey(key);
}

/**
 * The `npx agntc add …` line that installs an entry again in `scope`: its repo
 * and recorded path, or its local folder, with `--pack` for a pack. `version`
 * pins a remote source to that tag.
 */
export function reAddCommand(
	key: string,
	entry: ManifestEntry,
	scope: ScopeName,
	version?: string,
): string {
	const source =
		entry.commit === null
			? localItemDir(key, entry)
			: remoteSource(key, entry, version);
	const pack = entry.type === "pack" ? ["--pack"] : [];
	return agntcCommand(scope, "add", [source, ...pack]);
}

/** Where an entry's item comes from: a local entry's folder, else its path in the repo. */
export function installedFrom(key: string, entry: ManifestEntry): string {
	return entry.commit === null
		? localItemDir(key, entry)
		: remoteItemPath(key, entry);
}

function localItemDir(key: string, entry: ManifestEntry): string {
	const root = localRootOf(key, entry);
	return join(root, localItemPath(key, entry, root));
}

function remoteItemPath(key: string, entry: ManifestEntry): string {
	return entry.sourceSubpath || keySubpath(key);
}

/**
 * The `npx agntc add …` lines that install a group's entries again, all from
 * one repo: its loose skills on one `--skill` line, by folder name, and each
 * pack on a line of its own. A lone loose skill keeps its path form.
 */
export function groupReAddCommands(
	members: Array<{ key: string; entry: ManifestEntry }>,
	scope: ScopeName,
	version?: string,
): string[] {
	const packs = members.filter(({ entry }) => entry.type === "pack");
	const skills = members.filter(({ entry }) => entry.type !== "pack");
	const [first] = skills;
	const skillLines =
		first === undefined
			? []
			: skills.length === 1
				? [reAddCommand(first.key, first.entry, scope, version)]
				: [
						skillsCommand(
							addSourceFor(first.key, first.entry.cloneUrl),
							skills,
							scope,
							version,
						),
					];
	return [
		...skillLines,
		...packs.map(({ key, entry }) => reAddCommand(key, entry, scope, version)),
	];
}

function skillsCommand(
	source: string,
	skills: Array<{ key: string }>,
	scope: ScopeName,
	version: string | undefined,
): string {
	const names = skills.map(({ key }) => memberName(key)).sort();
	const located = locateSource(source, "", version);
	return agntcCommand(scope, "add", [located, "--skill", ...names]);
}

function remoteSource(
	key: string,
	entry: ManifestEntry,
	version: string | undefined,
): string {
	return locateSource(
		addSourceFor(key, entry.cloneUrl),
		remoteItemPath(key, entry),
		version,
	);
}
