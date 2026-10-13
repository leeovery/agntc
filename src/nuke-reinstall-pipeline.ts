import { basename, join } from "node:path";
import {
	absorptionNote,
	type Claims,
	claimFiles,
	takenOverRemoved,
} from "./absorb.js";
import { checkFileCollisions } from "./collision-check.js";
import {
	computeIncomingFiles,
	describeClash,
	findTargetClashes,
	skillClaims,
} from "./compute-incoming-files.js";
import { copyItem } from "./copy-item.js";
import { checkEscapingSymlinks } from "./copy-safety.js";
import {
	comparePaths,
	discover,
	PackConflictError,
	StartPathError,
} from "./discover.js";
import { reAddCommand, recordedSubpath, sourceIdOf } from "./entry-source.js";
import { errorMessage } from "./errors.js";
import { pathExists, relativePosix } from "./fs-utils.js";
import {
	type InstallItem,
	isEmptyPack,
	itemPath,
	pathLabel,
} from "./install-item.js";
import {
	buildManifestEntry,
	type Manifest,
	type ManifestEntry,
} from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import type { Scope } from "./scope.js";
import { memberName, repoFromKey } from "./source-parser.js";
import { checkUnmanagedConflicts } from "./unmanaged-check.js";

export interface NukeReinstallOptions {
	key: string;
	sourceDir: string;
	/**
	 * The cloned repository root: what `sourceDir` is relative to, and the
	 * containment boundary for the symlink-escape scan. For local-path mode it
	 * is the folder the source was added from.
	 */
	cloneRoot: string;
	existingEntry: ManifestEntry;
	/** Every installed entry, for what a pack's re-walk absorbs or clashes with. */
	installed: Manifest;
	scope: Scope;
	/**
	 * The ref a constrained resolve or a version change moves the entry to.
	 * Absent, the entry keeps its recorded ref: a branch stays on its branch,
	 * HEAD-tracked stays on HEAD.
	 */
	newRef?: string;
	/** The commit the reinstall lands on. Absent, the recorded one stays. */
	newCommit?: string;
}

interface NukeReinstallSuccess {
	status: "success";
	entry: ManifestEntry;
	copiedFiles: string[];
	/** What the user should hear about how the entry was reinstalled. */
	notes: string[];
	/** The loose skill entries a pack took over; their files are already removed. */
	absorbed: string[];
}

/**
 * The copy failed after the entry's files, and those of any loose skills it
 * took over, were removed.
 */
interface NukeReinstallCopyFailed {
	status: "copy-failed";
	errorMessage: string;
	recoveryHint: string;
	/** The loose skill entries a pack took over; their files are gone. */
	absorbed: string[];
}

/**
 * Removing the files of the entry, or of the loose skills it takes over,
 * failed part way. Nothing was copied, and every entry stays recorded so
 * whatever is left stays tracked.
 */
interface NukeReinstallRemoveFailed {
	status: "remove-failed";
	reason: string;
}

/**
 * The re-cloned tree can't be replayed for the entry, or files are in the way
 * of what it would install. Found before any file is removed, so the existing
 * install is left intact.
 */
interface NukeReinstallAborted {
	status: "aborted";
	reason: string;
	/** What stopped it was files in the way, which an add with --overwrite replaces. */
	inTheWay?: true;
}

/**
 * The source holds a symlink escaping the clone. Found before any file is
 * removed, so the existing install is left intact. Unlike an abort, the
 * remove+add remedy doesn't apply: it would trip the same guard.
 */
interface NukeReinstallBlocked {
	status: "blocked";
	reason: string;
}

/**
 * Nothing the entry installs is left upstream. Found before any file is
 * removed; whether to remove the entry is the caller's question.
 */
interface NukeReinstallGone {
	status: "gone";
}

export type NukeReinstallResult =
	| NukeReinstallSuccess
	| NukeReinstallCopyFailed
	| NukeReinstallRemoveFailed
	| NukeReinstallAborted
	| NukeReinstallBlocked
	| NukeReinstallGone;

/** What the re-cloned source now offers for an entry, decided before any delete. */
type Replay =
	| {
			ok: true;
			item: InstallItem;
			/** What the reinstalled entry records, which moves when its skill did. */
			sourceSubpath: string | undefined;
			note?: string;
	  }
	| { ok: false; reason: string }
	| { ok: false; gone: true };

const GONE: Replay = { ok: false, gone: true };

/** A replay cleared by every pre-flight check, with the loose skills it absorbs. */
interface ClearedReplay {
	status: "cleared";
	replay: Extract<Replay, { ok: true }>;
	absorbed: string[];
}

/**
 * Reinstalls an entry from a re-cloned source, replaying its recorded type.
 * Every check — what the source still holds, what is in the way of the files
 * it would install, and the symlink-escape scan — runs before any file is
 * removed.
 */
export async function executeNukeAndReinstall(
	options: NukeReinstallOptions,
): Promise<NukeReinstallResult> {
	const cleared = await clearReplay(options);
	if (cleared.status !== "cleared") {
		return cleared;
	}
	return reinstall(options, cleared);
}

async function clearReplay(
	options: NukeReinstallOptions,
): Promise<
	| ClearedReplay
	| NukeReinstallAborted
	| NukeReinstallBlocked
	| NukeReinstallGone
> {
	const { cloneRoot, existingEntry } = options;
	const replay =
		existingEntry.type === "pack"
			? await derivePackReplay(options)
			: await deriveSkillReplay(options);
	if (!replay.ok) {
		return "gone" in replay
			? { status: "gone" }
			: { status: "aborted", reason: replay.reason };
	}

	const way = await inTheWayOf(replay.item, options);
	if (way.clashes.size > 0 || way.unmanaged.length > 0) {
		return { status: "aborted", reason: inTheWayReason(way), inTheWay: true };
	}

	const symlinkCheck = await checkEscapingSymlinks(
		join(cloneRoot, itemPath(replay.item)),
		cloneRoot,
	);
	if (!symlinkCheck.ok) {
		return { status: "blocked", reason: symlinkCheck.message };
	}
	return { status: "cleared", replay, absorbed: way.absorbed };
}

async function reinstall(
	options: NukeReinstallOptions,
	{ replay, absorbed }: ClearedReplay,
): Promise<NukeReinstallResult> {
	const { key, cloneRoot, existingEntry, installed, scope } = options;

	try {
		await nukeManifestFiles(scope.root, [
			...existingEntry.files,
			...absorbed.flatMap((looseKey) => installed[looseKey]?.files ?? []),
		]);
	} catch (err: unknown) {
		return {
			status: "remove-failed",
			reason: `couldn't remove its old files: ${errorMessage(err)}`,
		};
	}

	let copiedFiles: string[];
	try {
		({ copiedFiles } = await copyItem(replay.item, cloneRoot, scope.root));
	} catch (err: unknown) {
		return copyFailed(options, err, absorbed);
	}

	return {
		status: "success",
		entry: buildReplayedEntry(options, copiedFiles, replay),
		copiedFiles,
		notes: [
			...(replay.note !== undefined ? [replay.note] : []),
			...absorbed.map((looseKey) => absorptionNote(key, looseKey)),
		],
		absorbed,
	};
}

/** A skill whose recorded path no longer holds one is looked for by name. */
async function deriveSkillReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { key, sourceDir, existingEntry } = options;
	const path = startPathOf(options);
	const name = memberName(key);
	if (await pathExists(join(sourceDir, "SKILL.md"))) {
		return {
			ok: true,
			item: skillAt(path, name),
			sourceSubpath: existingEntry.sourceSubpath,
		};
	}
	return followMovedSkill(options, path, name);
}

/**
 * Re-walks the whole source for skills named like the entry, loose or in a
 * pack: exactly one is followed, none means the skill is gone upstream, and
 * several can't be told apart.
 */
async function followMovedSkill(
	options: NukeReinstallOptions,
	oldPath: string,
	name: string,
): Promise<Replay> {
	const { key, cloneRoot, existingEntry } = options;
	const rootName = sourceRootName(options);
	const { skills, packs } = await discover(cloneRoot, { rootName });
	const matches = [...skills, ...packs.flatMap((pack) => pack.skills)]
		.filter((skill) => skill.name === name)
		.map((skill) => skill.path)
		.sort(comparePaths);
	const [newPath] = matches;
	const label = (path: string) => pathLabel(path, rootName);

	if (newPath === undefined) {
		return GONE;
	}
	if (matches.length > 1) {
		return {
			ok: false,
			reason: `its SKILL.md is gone from ${label(oldPath)} and ${matches.length} skills are now named ${name}: ${matches.join(", ")}`,
		};
	}
	return {
		ok: true,
		item: skillAt(newPath, name),
		sourceSubpath: recordedSubpath(key, existingEntry, cloneRoot, newPath),
		note: `${key} moved from ${label(oldPath)} to ${label(newPath)}`,
	};
}

/**
 * Re-walks a pack so skills added upstream arrive and removed ones go. A path
 * that is now a single skill reinstalls as that skill; a path that is gone,
 * or holds nothing, is gone upstream. Two of its skills sharing a folder name
 * would install to one place, so the pack aborts.
 */
async function derivePackReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { key, cloneRoot, existingEntry } = options;
	const startPath = startPathOf(options);
	const rootName = memberName(key);
	const { sourceSubpath } = existingEntry;

	try {
		const { packs } = await discover(cloneRoot, {
			startPath,
			forcePack: true,
			rootName,
		});
		const [pack] = packs;
		if (pack === undefined || isEmptyPack(pack)) {
			return GONE;
		}
		const clashes = findTargetClashes(skillClaims(pack.skills));
		if (clashes.length > 0) {
			return { ok: false, reason: clashes.map(describeClash).join("; ") };
		}
		return { ok: true, item: { kind: "pack", pack }, sourceSubpath };
	} catch (err) {
		if (err instanceof PackConflictError && err.conflict === "single-skill") {
			return {
				ok: true,
				item: skillAt(startPath, rootName),
				sourceSubpath,
				note: `${key} is a single skill — reinstalled as a skill`,
			};
		}
		if (err instanceof PackConflictError) {
			return { ok: false, reason: "its folder now contains packs" };
		}
		if (err instanceof StartPathError) {
			return GONE;
		}
		throw err;
	}
}

/** Whatever already sits where the item installs, besides the entry's own files. */
interface InTheWay extends Claims {
	/** Files agntc didn't install. */
	unmanaged: string[];
}

/**
 * Sorts out what sits at every path the item would claim. Only a pack absorbs
 * loose skills from its own source; any other entry's files clash.
 */
async function inTheWayOf(
	item: InstallItem,
	{ key, cloneRoot, existingEntry, installed, scope }: NukeReinstallOptions,
): Promise<InTheWay> {
	const incoming = await computeIncomingFiles(item, cloneRoot);
	const claims: Claims =
		item.kind === "pack"
			? claimFiles(incoming, installed, key, sourceIdOf(key, existingEntry))
			: {
					absorbed: [],
					clashes: checkFileCollisions(incoming, installed, key),
				};
	return {
		...claims,
		unmanaged: await checkUnmanagedConflicts(incoming, installed, scope.root),
	};
}

function inTheWayReason({ clashes, unmanaged }: InTheWay): string {
	const owned = [...clashes].map(
		([other, files]) => `files of ${other} are in the way: ${files.join(", ")}`,
	);
	const unowned =
		unmanaged.length > 0
			? [`files agntc didn't install are in the way: ${unmanaged.join(", ")}`]
			: [];
	return [...owned, ...unowned].join("; ");
}

function startPathOf({ cloneRoot, sourceDir }: NukeReinstallOptions): string {
	return relativePosix(cloneRoot, sourceDir);
}

/** What the walk root is called: the local folder, or the repo. */
function sourceRootName({
	key,
	cloneRoot,
	existingEntry,
}: NukeReinstallOptions): string {
	return existingEntry.commit === null
		? basename(cloneRoot)
		: memberName(repoFromKey(key));
}

function skillAt(path: string, name: string): InstallItem {
	return { kind: "skill", skill: { name, path } };
}

function buildReplayedEntry(
	options: NukeReinstallOptions,
	copiedFiles: string[],
	replay: Extract<Replay, { ok: true }>,
): ManifestEntry {
	const { existingEntry, newRef, newCommit } = options;
	return buildManifestEntry({
		ref: newRef ?? existingEntry.ref,
		commit: newCommit ?? existingEntry.commit,
		files: copiedFiles,
		type: replay.item.kind,
		cloneUrl: existingEntry.cloneUrl ?? null,
		constraint: existingEntry.constraint,
		sourceSubpath: replay.sourceSubpath,
		localRoot: existingEntry.localRoot,
	});
}

function copyFailed(
	{ key, existingEntry, scope }: NukeReinstallOptions,
	err: unknown,
	absorbed: string[],
): NukeReinstallCopyFailed {
	const takenOver =
		absorbed.length > 0 ? `, and ${takenOverRemoved(absorbed)}` : "";
	return {
		status: "copy-failed",
		errorMessage: errorMessage(err),
		absorbed,
		recoveryHint:
			`Update failed for ${key} after removing old files${takenOver}. ` +
			`It is currently uninstalled. ` +
			`Run \`${reAddCommand(key, existingEntry, scope.name)}\` to install it again.`,
	};
}
