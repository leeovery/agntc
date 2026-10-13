import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import type { ManifestEntry } from "./manifest.js";
import {
	deriveCloneUrlFromKey,
	localSourceRoot,
	memberName,
	repoFromKey,
} from "./source-parser.js";

/** A remote key's path below `owner/repo`: `""` for a root key. */
export function keySuffix(key: string): string {
	return key.split("/").slice(2).join("/");
}

/** What makes two entries come from the same source. */
export type SourceId =
	| { kind: "remote"; cloneUrl: string }
	| { kind: "local"; root: string };

export function sourceIdOf(key: string, entry: ManifestEntry): SourceId {
	return entry.commit === null
		? { kind: "local", root: localSourceRoot(key, entry.sourceSubpath) }
		: { kind: "remote", cloneUrl: deriveCloneUrlFromKey(key, entry.cloneUrl) };
}

/**
 * Remote sources match on clone URL. A local entry's root is the folder it
 * was added from only when it records a `sourceSubpath`; otherwise it is the
 * item's own folder, inside that source. So two local roots match when either
 * holds the other.
 */
export function isSameSource(a: SourceId, b: SourceId): boolean {
	if (a.kind === "remote") {
		return b.kind === "remote" && a.cloneUrl === b.cloneUrl;
	}
	return b.kind === "local" && (holds(a.root, b.root) || holds(b.root, a.root));
}

function holds(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The `sourceSubpath` that leads update to `path`, a folder relative to the
 * root the entry's source was walked from. Omitted when the key alone leads
 * there.
 */
export function recordedSubpath(
	key: string,
	entry: ManifestEntry,
	walkRoot: string,
	path: string,
): string | undefined {
	if (entry.commit !== null) {
		return path === keySuffix(key) ? undefined : path;
	}
	const dir = join(walkRoot, path);
	return dir === key
		? undefined
		: relative(dirname(key), dir).split(sep).join(posix.sep);
}

/**
 * The `npx agntc add …` line that installs an entry again: its repo and
 * recorded path, or its local folder, with `--pack` for a pack. `version`
 * pins a remote source to that tag.
 */
export function reAddCommand(
	key: string,
	entry: ManifestEntry,
	version?: string,
): string {
	const source =
		entry.commit === null
			? join(
					localSourceRoot(key, entry.sourceSubpath),
					entry.sourceSubpath ?? "",
				)
			: remoteSource(key, entry, version);
	return `npx agntc add ${source}${entry.type === "pack" ? " --pack" : ""}`;
}

/**
 * The `npx agntc add …` lines that install a group's entries again, all from
 * one repo: its loose skills on one `--skill` line, by folder name, and each
 * pack on a line of its own. A lone loose skill keeps its path form.
 */
export function groupReAddCommands(
	members: Array<{ key: string; entry: ManifestEntry }>,
	version?: string,
): string[] {
	const packs = members.filter(({ entry }) => entry.type === "pack");
	const skills = members.filter(({ entry }) => entry.type !== "pack");
	const [first] = skills;
	const skillLines =
		first === undefined
			? []
			: skills.length === 1
				? [reAddCommand(first.key, first.entry, version)]
				: [skillsCommand(repoFromKey(first.key), skills, version)];
	return [
		...skillLines,
		...packs.map(({ key, entry }) => reAddCommand(key, entry, version)),
	];
}

function skillsCommand(
	repo: string,
	skills: Array<{ key: string }>,
	version: string | undefined,
): string {
	const names = skills.map(({ key }) => memberName(key)).sort();
	const located = version === undefined ? repo : `${repo}@${version}`;
	return `npx agntc add ${located} --skill ${names.join(" ")}`;
}

function remoteSource(
	key: string,
	entry: ManifestEntry,
	version: string | undefined,
): string {
	const path = entry.sourceSubpath || keySuffix(key);
	const repo = repoFromKey(key);
	const located = path === "" ? repo : `${repo}/${path}`;
	return version === undefined ? located : `${located}@${version}`;
}
