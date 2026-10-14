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
import { checkItemLinks, copyItem } from "./copy-item.js";
import { type CopySource, inspectSourcePath } from "./copy-safety.js";
import {
	comparePaths,
	discover,
	type FoundSkill,
	folderName,
	PackConflictError,
	StartPathError,
	skillFolders,
} from "./discover.js";
import { droppedButInSource } from "./dropped-folders.js";
import { restoreCommand, sourceIdOf, sourceKeyOf } from "./entry-source.js";
import { errorMessage, gitErrorCause } from "./errors.js";
import { pathExists, relativePosix } from "./fs-utils.js";
import {
	type InstallItem,
	type ItemKey,
	isEmptyPack,
	keyItem,
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
import { joinWithAnd } from "./summary.js";
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
	/**
	 * The walk of `cloneRoot` shared by every entry reinstalled from it.
	 * Absent, this reinstall walks the source on its own.
	 */
	walk?: SourceWalk;
}

/** Every skill a source holds, loose or in a pack: where a moved skill is looked for. */
export type SourceSkills = readonly Readonly<FoundSkill>[];

/** The whole-source walk under a root name, which names a skill at the root. */
export type SourceWalk = (rootName: string) => Promise<SourceSkills>;

/**
 * Walks `root` at most once per root name, however many entries ask. It lives
 * as long as the caller holds it: one per clone, so no walk outlives its tree.
 * A walk that fails is forgotten, so the next ask walks again.
 */
export function sourceWalk(root: string): SourceWalk {
	const walks = new Map<string, Promise<SourceSkills>>();
	return (rootName) => {
		let walk = walks.get(rootName);
		if (walk === undefined) {
			walk = skillsIn(root, rootName);
			walks.set(rootName, walk);
			walk.catch(() => walks.delete(rootName));
		}
		return walk;
	};
}

async function skillsIn(root: string, rootName: string): Promise<SourceSkills> {
	const { skills, packs } = await discover(root, { rootName });
	return Object.freeze(
		[...skills, ...packs.flatMap((pack) => pack.skills)].map((skill) =>
			Object.freeze({ ...skill }),
		),
	);
}

interface NukeReinstallSuccess {
	status: "success";
	/**
	 * The key the entry is recorded under now: the one `add` gives the replayed
	 * item, which differs from the old key when the item is keyed differently.
	 */
	key: string;
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
 * The re-cloned tree can't be replayed for the entry, the replay would remove
 * folders the source still has, or files are in the way of what it would
 * install. Found before any file is removed, so the existing install is left
 * intact.
 */
interface NukeReinstallAborted {
	status: "aborted";
	reason: string;
	/** What stopped it was files in the way, which an add with --overwrite replaces. */
	inTheWay?: true;
	/** What stopped it was another entry holding the key the item moves to. */
	takenKey?: string;
	/**
	 * What stopped it was folders it would remove that are still in its
	 * source, which a remove and add accept.
	 */
	stillInSource?: true;
	/**
	 * The item as the replay found it, under the key `add` gives it: set when
	 * the abort came after a replay, for a remedy that adds it again.
	 */
	replayed?: { key: string; entry: ManifestEntry };
}

/**
 * The source holds a symlink escaping the clone, or one at or above the
 * entry's recorded path. Found before any file is removed, so the existing
 * install is left intact. Unlike an abort, the remove+add remedy doesn't
 * apply: it would trip the same guard.
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
	| { ok: true; item: InstallItem; note?: string }
	| { ok: false; reason: string }
	| { ok: false; gone: true };

const GONE: Replay = { ok: false, gone: true };

/** A replay, with where `add` would record its item. */
interface KeyedReplay {
	replay: Extract<Replay, { ok: true }>;
	keyed: ItemKey;
}

/** A replay cleared by every pre-flight check, with the loose skills it absorbs. */
interface ClearedReplay extends KeyedReplay {
	status: "cleared";
	absorbed: string[];
	/** What the item's copy reads from: what the symlink-escape scan checked. */
	source: CopySource;
}

/**
 * Reinstalls an entry from a re-cloned source, replaying its recorded type,
 * under the key `add` would give what it replays to. Every check — a symlink
 * on the recorded path, what the source still holds, recorded folders it
 * would remove that the source still has, what is in the way of the files it
 * would install, whether that key is free, and the symlink-escape scan — runs
 * before any file is removed.
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
	const { key, cloneRoot, existingEntry } = options;
	const link = await linkOnRecordedPath(options);
	if (link !== null) {
		return { status: "blocked", reason: link };
	}
	const replay =
		existingEntry.type === "pack"
			? await derivePackReplay(options)
			: await deriveSkillReplay(options);
	if (!replay.ok) {
		return "gone" in replay
			? { status: "gone" }
			: { status: "aborted", reason: replay.reason };
	}

	const keyed = keyItem(replay.item, sourceKeyOf(key, existingEntry));
	const incoming = await computeIncomingFiles(replay.item, cloneRoot);
	const dropped = await droppedButInSource(
		existingEntry.files,
		incoming,
		replay.item,
		cloneRoot,
	);
	if (dropped.length > 0) {
		return {
			status: "aborted",
			reason: droppedReason(dropped),
			stillInSource: true,
			replayed: replayedAs(options, { replay, keyed }),
		};
	}
	const way = await inTheWayOf(replay.item, incoming, options);
	if (isKeyTaken(keyed.key, options, way)) {
		return {
			status: "aborted",
			reason: `it would move to ${keyed.key}, which is already installed`,
			takenKey: keyed.key,
			replayed: replayedAs(options, { replay, keyed }),
		};
	}
	if (way.clashes.size > 0 || way.unmanaged.length > 0) {
		return {
			status: "aborted",
			reason: inTheWayReason(way),
			inTheWay: true,
			replayed: replayedAs(options, { replay, keyed }),
		};
	}

	const source = { root: cloneRoot, local: existingEntry.commit === null };
	const symlinkCheck = await checkItemLinks(replay.item, source);
	if (!symlinkCheck.ok) {
		return { status: "blocked", reason: symlinkCheck.message };
	}
	return { status: "cleared", replay, keyed, absorbed: way.absorbed, source };
}

async function reinstall(
	options: NukeReinstallOptions,
	cleared: ClearedReplay,
): Promise<NukeReinstallResult> {
	const { key, existingEntry, installed, scope } = options;
	const { replay, keyed, absorbed, source } = cleared;

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
		({ copiedFiles } = await copyItem(replay.item, source, scope.root));
	} catch (err: unknown) {
		return copyFailed(options, err, cleared);
	}

	return {
		status: "success",
		key: keyed.key,
		entry: replayedEntry(options, cleared, copiedFiles),
		copiedFiles,
		notes: [
			...replayNotes(key, keyed.key, replay.note),
			...absorbed.map((looseKey) => absorptionNote(keyed.key, looseKey)),
		],
		absorbed,
	};
}

/** The replay's note and the key the entry moved to, told as one note. */
function replayNotes(
	key: string,
	newKey: string,
	note: string | undefined,
): string[] {
	if (newKey === key) {
		return note === undefined ? [] : [note];
	}
	return [
		note === undefined
			? `${key} is now keyed ${newKey}`
			: `${note}, now keyed ${newKey}`,
	];
}

/**
 * A skill is named by its folder, as `add` names it, and one whose recorded
 * path no longer holds it is looked for by that name.
 */
async function deriveSkillReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { sourceDir } = options;
	const path = startPathOf(options);
	const name = folderName(path, sourceRootName(options));
	if (await pathExists(join(sourceDir, "SKILL.md"))) {
		return { ok: true, item: skillAt(path, name) };
	}
	return followMovedSkill(options, path, name);
}

/**
 * Looks through the whole source's walk for skills named like the entry,
 * loose or in a pack: exactly one is followed, none means the skill is gone
 * upstream, and several can't be told apart.
 */
async function followMovedSkill(
	options: NukeReinstallOptions,
	oldPath: string,
	name: string,
): Promise<Replay> {
	const { key, cloneRoot, walk = sourceWalk(cloneRoot) } = options;
	const rootName = sourceRootName(options);
	const matches = (await walk(rootName))
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
		note: `${key} moved from ${label(oldPath)} to ${label(newPath)}`,
	};
}

/**
 * Re-walks a pack so skills and support folders added upstream arrive and
 * removed ones go. A path that is now a single skill reinstalls as that
 * skill; a path that is gone, or holds nothing, is gone upstream. Two of its
 * skills or support folders sharing a folder name would install to one place,
 * so the pack aborts.
 */
async function derivePackReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { key, cloneRoot } = options;
	const startPath = startPathOf(options);
	const rootName = sourceRootName(options);

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
		const clashes = findTargetClashes(skillClaims(skillFolders(pack)));
		if (clashes.length > 0) {
			return { ok: false, reason: clashes.map(describeClash).join("; ") };
		}
		return { ok: true, item: { kind: "pack", pack } };
	} catch (err) {
		if (err instanceof PackConflictError && err.conflict === "single-skill") {
			return {
				ok: true,
				item: skillAt(startPath, folderName(startPath, rootName)),
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
 * Sorts out what sits at every path the item would claim, `incoming`. Only a
 * pack absorbs loose skills from its own source, and only those its skills
 * land on; any other entry's files clash.
 */
async function inTheWayOf(
	item: InstallItem,
	incoming: string[],
	{ key, existingEntry, installed, scope }: NukeReinstallOptions,
): Promise<InTheWay> {
	const claims: Claims =
		item.kind === "pack"
			? claimFiles(
					item.pack,
					incoming,
					installed,
					key,
					sourceIdOf(key, existingEntry),
				)
			: {
					absorbed: [],
					clashes: checkFileCollisions(incoming, installed, key),
				};
	return {
		...claims,
		unmanaged: await checkUnmanagedConflicts(incoming, installed, scope.root),
	};
}

/**
 * Another entry holds `newKey`, the key the entry moves to: one the item takes
 * over frees it, its entry dropped in the same write.
 */
function isKeyTaken(
	newKey: string,
	{ key, installed }: NukeReinstallOptions,
	{ absorbed }: InTheWay,
): boolean {
	return newKey !== key && newKey in installed && !absorbed.includes(newKey);
}

function droppedReason(names: string[]): string {
	const are = names.length === 1 ? "is" : "are";
	return `it would remove ${joinWithAnd(names)}, which ${are} still in the source but would no longer be installed`;
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

/**
 * Names a symlink at or above the recorded path, as `add` refuses one: the
 * replay would read through it, out of the clone even, and a pack's walk
 * would take it for a path that's gone.
 */
async function linkOnRecordedPath(
	options: NukeReinstallOptions,
): Promise<string | null> {
	const path = startPathOf(options);
	const state = await inspectSourcePath(options.cloneRoot, path);
	return state.kind === "link"
		? `symlink "${state.at}" is on the path to ${path} — agntc won't copy through it`
		: null;
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

/**
 * The replayed item as the entry it would be, under the key `add` gives it:
 * what a remedy that adds it again installs.
 */
function replayedAs(
	options: NukeReinstallOptions,
	keyedReplay: KeyedReplay,
): { key: string; entry: ManifestEntry } {
	return {
		key: keyedReplay.keyed.key,
		entry: replayedEntry(options, keyedReplay, []),
	};
}

/** The entry recorded for the replayed item, holding `files`. */
function replayedEntry(
	{ existingEntry, newRef, newCommit }: NukeReinstallOptions,
	{ replay, keyed }: KeyedReplay,
	files: string[],
): ManifestEntry {
	return buildManifestEntry({
		ref: newRef ?? existingEntry.ref,
		commit: newCommit ?? existingEntry.commit,
		files,
		type: replay.item.kind,
		cloneUrl: existingEntry.cloneUrl ?? null,
		constraint: existingEntry.constraint,
		sourceSubpath: keyed.sourceSubpath,
		localRoot: existingEntry.localRoot,
	});
}

/**
 * The hint names what went wrong, the error's first line, and its remedy
 * installs the item as replayed, under the key `add` gives it, at the version
 * the replayed entry tracks.
 */
function copyFailed(
	options: NukeReinstallOptions,
	err: unknown,
	cleared: ClearedReplay,
): NukeReinstallCopyFailed {
	const { key, scope } = options;
	const { absorbed } = cleared;
	const message = errorMessage(err);
	const cause = gitErrorCause(message);
	const why = cause === "" ? "" : ` (${cause})`;
	const takenOver =
		absorbed.length > 0 ? `, and ${takenOverRemoved(absorbed)}` : "";
	const replayed = replayedAs(options, cleared);
	const reAdd = restoreCommand(replayed.key, replayed.entry, scope.name);
	return {
		status: "copy-failed",
		errorMessage: message,
		absorbed,
		recoveryHint:
			`Update failed for ${key} after removing old files${why}${takenOver}. ` +
			`It is currently uninstalled. ` +
			`Run \`${reAdd}\` to install it again.`,
	};
}
