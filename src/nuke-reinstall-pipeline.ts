import { join, posix, relative, sep } from "node:path";
import { copyItem } from "./copy-item.js";
import { checkEscapingSymlinks } from "./copy-safety.js";
import { discover, PackConflictError, StartPathError } from "./discover.js";
import { errorMessage } from "./errors.js";
import { pathExists } from "./fs-utils.js";
import { type InstallItem, isEmptyPack } from "./install-item.js";
import {
	buildManifestEntry,
	type EntryType,
	type ManifestEntry,
} from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { memberName } from "./source-parser.js";

export interface NukeReinstallOptions {
	key: string;
	sourceDir: string;
	/**
	 * The cloned repository root: what `sourceDir` is relative to, and the
	 * containment boundary for the symlink-escape scan. For local-path mode the
	 * provided source root is the boundary (`cloneRoot === sourceDir`).
	 */
	cloneRoot: string;
	existingEntry: ManifestEntry;
	projectDir: string;
	newRef?: string | null;
	newCommit?: string | null;
}

interface NukeReinstallSuccess {
	status: "success";
	entry: ManifestEntry;
	copiedFiles: string[];
	/** Something the user should hear about how the entry was reinstalled. */
	note?: string;
}

interface NukeReinstallCopyFailed {
	status: "copy-failed";
	errorMessage: string;
	recoveryHint: string;
}

/**
 * The re-cloned tree no longer supports the entry's recorded type. Found
 * before any file is removed, so the existing install is left intact.
 */
interface NukeReinstallAborted {
	status: "aborted";
	recordedType: EntryType;
	reason: string;
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

export type NukeReinstallResult =
	| NukeReinstallSuccess
	| NukeReinstallCopyFailed
	| NukeReinstallAborted
	| NukeReinstallBlocked;

/** What the re-cloned source now offers for an entry, decided before any delete. */
type Replay =
	| { ok: true; item: InstallItem; note?: string }
	| { ok: false; reason: string };

/**
 * Reinstalls an entry from a re-cloned source, replaying its recorded type.
 * Every check — that the source still supports the type, and the
 * symlink-escape scan — runs before the entry's files are removed.
 */
export async function executeNukeAndReinstall(
	options: NukeReinstallOptions,
): Promise<NukeReinstallResult> {
	const { key, sourceDir, cloneRoot, existingEntry, projectDir } = options;
	const recordedType = existingEntry.type ?? "skill";

	const replay =
		recordedType === "pack"
			? await derivePackReplay(options)
			: await deriveSkillReplay(options);
	if (!replay.ok) {
		return { status: "aborted", recordedType, reason: replay.reason };
	}

	const symlinkCheck = await checkEscapingSymlinks(sourceDir, cloneRoot);
	if (!symlinkCheck.ok) {
		return { status: "blocked", reason: symlinkCheck.message };
	}

	await nukeManifestFiles(projectDir, existingEntry.files);

	let copiedFiles: string[];
	try {
		({ copiedFiles } = await copyItem(replay.item, cloneRoot, projectDir));
	} catch (err: unknown) {
		return copyFailed(key, err);
	}

	return {
		status: "success",
		entry: buildReplayedEntry(options, copiedFiles, replay.item.kind),
		copiedFiles,
		...(replay.note !== undefined ? { note: replay.note } : {}),
	};
}

async function deriveSkillReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { key, sourceDir } = options;
	if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
		return {
			ok: false,
			reason: "SKILL.md is no longer present in the source",
		};
	}
	return { ok: true, item: skillAt(startPathOf(options), memberName(key)) };
}

/**
 * Re-walks a pack so skills added upstream arrive and removed ones go. A path
 * that is now a single skill reinstalls as that skill.
 */
async function derivePackReplay(
	options: NukeReinstallOptions,
): Promise<Replay> {
	const { key, cloneRoot } = options;
	const startPath = startPathOf(options);
	const rootName = memberName(key);

	try {
		const { packs } = await discover(cloneRoot, {
			startPath,
			forcePack: true,
			rootName,
		});
		const [pack] = packs;
		if (pack === undefined || isEmptyPack(pack)) {
			return {
				ok: false,
				reason: "it no longer holds any skills, agents or hooks",
			};
		}
		return { ok: true, item: { kind: "pack", pack } };
	} catch (err) {
		if (err instanceof PackConflictError && err.conflict === "single-skill") {
			return {
				ok: true,
				item: skillAt(startPath, rootName),
				note: `${key} is a single skill — reinstalled as a skill`,
			};
		}
		if (err instanceof PackConflictError) {
			return { ok: false, reason: "its folder now contains packs" };
		}
		if (err instanceof StartPathError) {
			return { ok: false, reason: err.message };
		}
		throw err;
	}
}

function startPathOf({ cloneRoot, sourceDir }: NukeReinstallOptions): string {
	return relative(cloneRoot, sourceDir).split(sep).join(posix.sep);
}

function skillAt(path: string, name: string): InstallItem {
	return { kind: "skill", skill: { name, path } };
}

function buildReplayedEntry(
	options: NukeReinstallOptions,
	copiedFiles: string[],
	type: EntryType,
): ManifestEntry {
	const { existingEntry, newRef, newCommit } = options;
	return buildManifestEntry({
		ref: newRef !== undefined ? newRef : existingEntry.ref,
		commit: newCommit !== undefined ? newCommit : existingEntry.commit,
		files: copiedFiles,
		type,
		cloneUrl: existingEntry.cloneUrl ?? null,
		constraint: existingEntry.constraint,
		sourceSubpath: existingEntry.sourceSubpath,
	});
}

function copyFailed(key: string, err: unknown): NukeReinstallCopyFailed {
	return {
		status: "copy-failed",
		errorMessage: errorMessage(err),
		recoveryHint:
			`Update failed for ${key} after removing old files. ` +
			`It is currently uninstalled. ` +
			`Run \`npx agntc update ${key}\` to retry installation.`,
	};
}
