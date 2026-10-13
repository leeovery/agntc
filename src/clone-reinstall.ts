import { localItemPath, localRootOf, reAddCommand } from "./entry-source.js";
import { errorMessage } from "./errors.js";
import { validateLocalSourcePath } from "./fs-utils.js";
import { type CloneResult, cleanupTempDir, cloneSource } from "./git-clone.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { addEntry, removeEntry, writeManifest } from "./manifest.js";
import {
	executeNukeAndReinstall,
	type NukeReinstallOptions,
	type NukeReinstallResult,
} from "./nuke-reinstall-pipeline.js";
import { agntcCommand, type Scope, type ScopeName } from "./scope.js";
import {
	buildParsedSourceFromKey,
	guardSourceDir,
	resolveGuardedSourceDir,
} from "./source-parser.js";
import type { Ui } from "./ui.js";

export interface CloneAndReinstallOptions {
	key: string;
	entry: ManifestEntry;
	scope: Scope;
	newRef?: string;
	newCommit?: string;
	/** The local folder to reinstall from instead of cloning. */
	sourceDir?: string;
	/** When provided, copy-failed will automatically remove the entry and write the manifest. */
	manifest?: Manifest;
}

/**
 * Per-call inputs the four reinstall entry points layer on top of the shared
 * key/entry/scope triple: an optional `manifest` (enables copy-failed
 * removal), and version overrides (`newRef`/`newCommit`) for constrained or
 * change-version flows.
 */
export interface PrepareReinstallOpts {
	manifest?: Manifest;
	newRef?: string;
	newCommit?: string;
}

export type PrepareReinstallResult =
	| { ok: true; options: CloneAndReinstallOptions }
	| { ok: false; reason: string };

/**
 * Shared preparation for the four update entry points (update single, update
 * all, list update action, list change-version action). Detects local vs remote
 * from `entry.commit === null`, validates the local source folder when local,
 * and assembles the {@link CloneAndReinstallOptions} object (including that
 * folder as `sourceDir` for local installs). On a failed local-path check it
 * returns `{ ok: false }` carrying the validation reason, naming the folder; callers
 * print it as it is.
 */
export async function prepareReinstall(
	key: string,
	entry: ManifestEntry,
	scope: Scope,
	opts: PrepareReinstallOpts = {},
): Promise<PrepareReinstallResult> {
	const localRoot = entry.commit === null ? localRootOf(key, entry) : undefined;

	if (localRoot !== undefined) {
		const pathResult = await validateLocalSourcePath(localRoot);
		if (!pathResult.valid) {
			return { ok: false, reason: `${localRoot}: ${pathResult.reason}` };
		}
	}

	const options: CloneAndReinstallOptions = {
		key,
		entry,
		scope,
		...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
		...(localRoot !== undefined ? { sourceDir: localRoot } : {}),
		...(opts.newRef !== undefined ? { newRef: opts.newRef } : {}),
		...(opts.newCommit !== undefined ? { newCommit: opts.newCommit } : {}),
	};

	return { ok: true, options };
}

interface CloneReinstallSuccess {
	status: "success";
	/** The key `manifestEntry` goes under: the entry's own, or the one `add` now gives it. */
	key: string;
	manifestEntry: ManifestEntry;
	copiedFiles: string[];
	/** What the user should hear about how the entry was reinstalled. */
	notes: string[];
	/** Loose skill entries a pack took over: their files are gone, their entries are the caller's to drop. */
	absorbed: string[];
}

/**
 * Nothing the entry installs is left in its source. Nothing was touched; the
 * caller decides whether to remove it.
 */
type CloneReinstallGone = Extract<NukeReinstallResult, { status: "gone" }>;

/**
 * A copy failure has already removed the entry's files, and those of the loose
 * skills a pack took over: `absorbed` names those, whose entries go too. A
 * removal failure keeps every entry, so whatever is left stays tracked.
 */
export type CloneReinstallFailed =
	| {
			status: "failed";
			failureReason: "clone-failed" | "remove-failed";
			message: string;
	  }
	| {
			status: "failed";
			failureReason: "copy-failed";
			message: string;
			absorbed: string[];
	  };

/**
 * The non-success clone-reinstall outcomes: the union {@link mapCloneFailure}
 * accepts and {@link isCloneReinstallFailure} narrows to. Defined once here,
 * beside its mapper, so a new non-success status is a single-site change that
 * propagates the narrowing to every call site.
 */
export type CloneReinstallFailure =
	| CloneReinstallFailed
	| CloneReinstallAborted
	| CloneReinstallBlocked;

export interface CloneFailureHandlers<T> {
	onCloneFailed: (msg: string) => T;
	onCopyFailed: (msg: string, absorbed: string[]) => T;
	onAborted: (abort: AbortCause) => T;
	onBlocked: (reason: string) => T;
	onRemoveFailed: (msg: string) => T;
}

/**
 * Narrows a {@link CloneReinstallResult} to the non-success
 * {@link CloneReinstallFailure} union — the exact set {@link mapCloneFailure}
 * accepts. Co-locates the failure-status set with its mapper so the four
 * reinstall entry points share one definition.
 */
export function isCloneReinstallFailure(
	result: CloneReinstallResult,
): result is CloneReinstallFailure {
	return (
		result.status === "failed" ||
		result.status === "aborted" ||
		result.status === "blocked"
	);
}

/**
 * Routes a non-success clone-reinstall result to the matching handler, using
 * `status` as the single cross-boundary discriminator for the two
 * structurally-distinct cases that leave the existing install intact:
 * `aborted` (derive-before-delete — re-cloned tree no longer supports the
 * recorded type) and `blocked` (copy-safety — a symlink in the source agntc
 * won't follow). The remaining `failed` family is refined on
 * `failureReason` into clone-failed / copy-failed / remove-failed.
 */
export function mapCloneFailure<T>(
	result: CloneReinstallFailure,
	handlers: CloneFailureHandlers<T>,
): T {
	if (result.status === "aborted") {
		return handlers.onAborted(result);
	}
	if (result.status === "blocked") {
		return handlers.onBlocked(result.reason);
	}
	switch (result.failureReason) {
		case "clone-failed":
			return handlers.onCloneFailed(result.message);
		case "copy-failed":
			return handlers.onCopyFailed(result.message, result.absorbed);
		case "remove-failed":
			return handlers.onRemoveFailed(result.message);
	}
}

/**
 * Collapses any {@link CloneReinstallFailure} to a single user-facing message,
 * shared by the two `list` actions (update + change-version) whose failure tails
 * were otherwise byte-identical. Implemented in terms of {@link mapCloneFailure}
 * so the dispatch logic isn't re-authored: clone-failed/copy-failed/remove-failed
 * pass through the failure's own message, `aborted` routes through
 * {@link buildAbortMessage} and `blocked` through
 * {@link buildCopySafetyMessage}. A new failure variant is a single edit here;
 * the list actions can't drift. update.ts keeps its richer per-status handler.
 * `version` is the tag a version change asked for ({@link buildAbortMessage}).
 */
export function failureMessage(
	result: CloneReinstallFailure,
	key: string,
	entry: ManifestEntry,
	scope: ScopeName,
	version?: string,
): string {
	return mapCloneFailure<string>(result, {
		onCloneFailed: (msg) => msg,
		onCopyFailed: (msg) => msg,
		onRemoveFailed: (msg) => msg,
		onAborted: (abort) => buildAbortMessage(key, entry, abort, scope, version),
		onBlocked: (reason) => buildCopySafetyMessage(key, reason),
	});
}

/**
 * The unit's update was aborted by the derive-before-delete validation gate: the
 * re-cloned tree can't be replayed for the entry, so no files were removed and
 * the existing install is left intact. Carries the structured cause
 * ({@link reason}); the user-facing message and manual remedy are assembled by
 * the reporting layer. The distinct `status: "aborted"` is the single
 * discriminator: {@link mapCloneFailure} dispatches it via `onAborted` on
 * `status` alone, keeping it separate from the `status: "failed"` reasons
 * (notably copy-failed, which removes the entry) without a redundant second tag.
 */
export type CloneReinstallAborted = Extract<
	NukeReinstallResult,
	{ status: "aborted" }
>;

/** Why an update aborted, as {@link buildAbortMessage} reports it. */
export type AbortCause = Omit<CloneReinstallAborted, "status">;

/**
 * The unit's update was blocked by the copy-safety pre-flight: the re-cloned
 * source holds a symlink agntc won't follow, leading out of the clone or on
 * the entry's path. It runs BEFORE any file removal, so the existing install
 * is left fully intact (no nuke, no copy, manifest unchanged). Distinct from
 * {@link CloneReinstallAborted}: there is no recorded-type mismatch, so the
 * report must NOT offer the remove+add migrate remedy (it just re-trips the same
 * guard). The distinct `status: "blocked"` is the single discriminator;
 * {@link mapCloneFailure} dispatches it via `onBlocked` on `status` alone,
 * keeping it out of `handleCopyFailedRemoval` (which removes the entry).
 * {@link reason} carries the offending symlink; {@link buildCopySafetyMessage}
 * assembles the user-facing report.
 */
export type CloneReinstallBlocked = Extract<
	NukeReinstallResult,
	{ status: "blocked" }
>;

export type CloneReinstallResult =
	| CloneReinstallSuccess
	| CloneReinstallFailed
	| CloneReinstallAborted
	| CloneReinstallBlocked
	| CloneReinstallGone;

/**
 * The user-facing report for a derive-before-delete abort: why the source
 * can't be replayed for the entry, that the existing install is unchanged,
 * and the manual remedy. Its remove names the entry as installed; its re-add
 * installs the item as replayed when the abort came after a replay, else the
 * entry as recorded. Files in the way are cleared by hand or replaced by an
 * add with --overwrite, which update doesn't take; any other abort migrates
 * by remove+add. A key taken by another entry is freed by removing that
 * entry, after which update moves this one there: an add would refuse the
 * taken key too. Distinct from the copy-failed report, which tells the user
 * the unit is currently uninstalled and to re-run update — here nothing was
 * touched.
 *
 * `version` is the tag a version change asked for. An update follows the
 * entry's own constraint or pin, so it would never install that tag: the
 * remedy changes the version again instead, and its re-add pins that tag.
 */
export function buildAbortMessage(
	key: string,
	entry: ManifestEntry,
	{ reason, inTheWay, takenKey, replayed }: AbortCause,
	scope: ScopeName,
	version?: string,
): string {
	const again =
		version === undefined ? "update again" : `change it to ${version} again`;
	if (takenKey !== undefined) {
		const redo =
			version === undefined ? agntcCommand(scope, "update", [key]) : again;
		return (
			`${key} can't be updated: ${reason}. The existing install is ` +
			`unchanged. To replace that entry with it: ` +
			`${agntcCommand(scope, "remove", [takenKey])} then ${redo}`
		);
	}
	const reAdd = reAddCommand(
		replayed?.key ?? key,
		replayed?.entry ?? entry,
		scope,
		version,
	);
	const remove = agntcCommand(scope, "remove", [key]);
	if (inTheWay) {
		return (
			`${key} can't be updated: ${reason}. The existing install is ` +
			`unchanged. Clear them and ${again}, or replace them: ` +
			`${remove} then ${reAdd} --overwrite`
		);
	}
	return (
		`${key} was installed as a ${entry.type ?? "skill"} and can't be ` +
		`updated (${reason}). The existing install is unchanged. ` +
		`To migrate: ${remove} then ${reAdd}`
	);
}

/**
 * The user-facing report for a copy-safety block. Names the source (key) and
 * the offending link (the structured {@link reason} says why agntc won't
 * follow it), and affirms the
 * update is blocked with the existing install left intact. Mirrors the add
 * path's identity-prefixed cancel framing (`${key}: <reason>`). Deliberately
 * distinct from {@link buildAbortMessage}: this is a copy-safety violation, not
 * a recorded-type change, so it does NOT offer the remove+add migrate remedy —
 * remove+add would only re-trip the same guard.
 */
export function buildCopySafetyMessage(key: string, reason: string): string {
	return (
		`${key}: ${reason}. agntc won't follow that symlink, so the update is ` +
		`blocked. The existing install is unchanged.`
	);
}

/**
 * Spinner-free clone primitive: builds the parsed source from a key/entry (with
 * an optional `newRef` override — the constrained resolved-tag, forwarded as
 * `clone --branch <resolved-tag>`) and clones once via {@link cloneSource},
 * letting a clone failure propagate. Retry lives inside `cloneSource` (3×
 * internally), so a throw here is final. Shared by {@link cloneAndReinstall}
 * (which wraps it in its own spinner + clone-failed mapping) and the group
 * orchestrator, which clones once per repo then reinstalls many members against
 * the shared temp dir. Deliberately spinner-free: the grouped path owns its own
 * clone-progress rendering.
 */
export async function cloneRepoOnce(input: {
	key: string;
	entry: ManifestEntry;
	newRef?: string;
}): Promise<CloneResult> {
	const parsed = buildParsedSourceFromKey(
		input.key,
		input.newRef ?? input.entry.ref,
		input.entry.cloneUrl,
	);
	return cloneSource(parsed);
}

/**
 * `installed` is every entry the manifest holds, for what a pack's re-walk
 * absorbs or clashes with.
 */
export async function cloneAndReinstall(
	options: CloneAndReinstallOptions,
	ui: Ui,
	installed: Manifest,
): Promise<CloneReinstallResult> {
	const { key, entry, scope } = options;

	if (options.sourceDir !== undefined) {
		const localRoot = options.sourceDir;
		const guarded = guardSourceDir(
			localRoot,
			localItemPath(key, entry, localRoot),
		);
		if (!guarded.ok) {
			return {
				status: "failed",
				failureReason: "clone-failed",
				message: guarded.message,
			};
		}
		const result = await runPipeline({
			key,
			entry,
			installed,
			scope,
			sourceDir: guarded.sourceDir,
			cloneRoot: localRoot,
			newRef: options.newRef,
			newCommit: options.newCommit,
		});
		return handleCopyFailedRemoval(result, options);
	}

	// Remote mode: clone first
	let tempDir: string | undefined;

	try {
		const spin = ui.spinner();
		spin.start("Cloning repository...");

		let cloneResult: CloneResult;
		try {
			cloneResult = await cloneRepoOnce({
				key,
				entry,
				newRef: options.newRef,
			});
		} catch (err) {
			spin.stop("Clone failed");
			return {
				status: "failed",
				failureReason: "clone-failed",
				message: errorMessage(err),
			};
		}
		spin.stop("Cloned successfully");

		tempDir = cloneResult.tempDir;
		const newCommit = options.newCommit ?? cloneResult.commit;
		// Guard + source-dir resolution for the re-cloned tree is authored once in
		// resolveGuardedSourceDir, composed identically by the group orchestrator's
		// reinstallMember. It runs the source-dir rule (prefer the recorded
		// sourceSubpath, else the key-derived dir) behind the lexical
		// containment guard, gated BEFORE the join is first read (readConfig +
		// derive-before-delete in runPipeline both read at the joined path). A
		// recorded subpath that lexically escapes the clone (e.g. `../evil`) is
		// rejected pre-flight (no nuke, no copy, install intact) and maps to the same
		// clone-failed result this branch already returns. cloneRoot stays the whole
		// clone (tempDir), so within-clone cross-member symlinks are allowed and only
		// escapes beyond it are rejected.
		const guarded = resolveGuardedSourceDir(tempDir, key, entry.sourceSubpath);
		if (!guarded.ok) {
			return {
				status: "failed",
				failureReason: "clone-failed",
				message: guarded.message,
			};
		}
		const sourceDir = guarded.sourceDir;

		const result = await runPipeline({
			key,
			entry,
			installed,
			scope,
			sourceDir,
			// Clone mode: the clone temp dir is the containment boundary for the
			// symlink-escape scan. For a member unit `sourceDir` is a subdir of
			// tempDir, so within-clone cross-member symlinks are allowed; only
			// links escaping the whole clone are rejected.
			cloneRoot: tempDir,
			newRef: options.newRef,
			newCommit,
		});
		return handleCopyFailedRemoval(result, options);
	} finally {
		if (tempDir) {
			try {
				await cleanupTempDir(tempDir);
			} catch {
				// Swallow cleanup errors
			}
		}
	}
}

/**
 * `manifest` with a reinstalled entry under `key`, the key `add` gives it, in
 * place of the entry at `from`, and without the loose skills it took over,
 * `absorbed`. One of those may have held `key`, so they go before the entry is
 * recorded; an entry whose key moved leaves its old key in the same write.
 */
export function recordReinstall(
	manifest: Manifest,
	from: string,
	key: string,
	entry: ManifestEntry,
	absorbed: string[],
): Manifest {
	const dropped = from === key ? absorbed : [...absorbed, from];
	return addEntry(
		dropped.reduce((rest, gone) => removeEntry(rest, gone), manifest),
		key,
		entry,
	);
}

/**
 * `manifest` after a copy failure for the entry under `key`: the failure
 * removed its files and those of the loose skills it took over, `absorbed`,
 * so their entries go too.
 */
export function recordCopyFailure(
	manifest: Manifest,
	key: string,
	absorbed: string[],
): Manifest {
	return [key, ...absorbed].reduce(
		(rest, removed) => removeEntry(rest, removed),
		manifest,
	);
}

async function handleCopyFailedRemoval(
	result: CloneReinstallResult,
	options: CloneAndReinstallOptions,
): Promise<CloneReinstallResult> {
	if (
		result.status === "failed" &&
		result.failureReason === "copy-failed" &&
		options.manifest !== undefined
	) {
		await writeManifest(
			options.scope.root,
			recordCopyFailure(options.manifest, options.key, result.absorbed),
		);
	}
	return result;
}

/** {@link NukeReinstallOptions}, with the entry under its caller-side name. */
export interface PipelineInput
	extends Omit<NukeReinstallOptions, "existingEntry"> {
	entry: ManifestEntry;
}

/**
 * The reinstall half of the update pipeline, decoupled from cloning: given an
 * already-resolved `sourceDir` and its containment `cloneRoot`, it runs the
 * symlink-escape pre-flight, derive-before-delete gate, nuke, and re-copy via
 * {@link executeNukeAndReinstall}, mapping the result to a
 * {@link CloneReinstallResult}. {@link cloneAndReinstall} calls it after its own
 * single clone; the group orchestrator ({@link processGroupUpdate}) calls it
 * once per member against a shared clone, so the two owners cannot drift.
 */
export async function runPipeline(
	input: PipelineInput,
): Promise<CloneReinstallResult> {
	const { entry, ...rest } = input;
	const pipelineResult = await executeNukeAndReinstall({
		...rest,
		existingEntry: entry,
	});

	switch (pipelineResult.status) {
		case "copy-failed":
			return {
				status: "failed",
				failureReason: "copy-failed",
				message: pipelineResult.recoveryHint,
				absorbed: pipelineResult.absorbed,
			};
		case "remove-failed":
			return {
				status: "failed",
				failureReason: "remove-failed",
				message: pipelineResult.reason,
			};
		case "success":
			return {
				status: "success",
				key: pipelineResult.key,
				manifestEntry: pipelineResult.entry,
				copiedFiles: pipelineResult.copiedFiles,
				notes: pipelineResult.notes,
				absorbed: pipelineResult.absorbed,
			};
		default:
			// Aborted, blocked and gone leave the entry intact: with no
			// failureReason, handleCopyFailedRemoval never removes it.
			return pipelineResult;
	}
}
