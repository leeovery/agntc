import { join } from "node:path";
import * as p from "@clack/prompts";
import type { AgentId } from "./drivers/types.js";
import { errorMessage } from "./errors.js";
import { validateLocalSourcePath } from "./fs-utils.js";
import { cleanupTempDir, cloneSource } from "./git-clone.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { removeEntry, writeManifest } from "./manifest.js";
import { executeNukeAndReinstall } from "./nuke-reinstall-pipeline.js";
import {
	buildParsedSourceFromKey,
	getSourceDirFromKey,
} from "./source-parser.js";

export interface CloneAndReinstallOptions {
	key: string;
	entry: ManifestEntry;
	projectDir: string;
	newRef?: string;
	newCommit?: string;
	/** Provide to skip cloning (local path). */
	sourceDir?: string;
	/** When provided, copy-failed will automatically remove the entry and write the manifest. */
	manifest?: Manifest;
}

/**
 * Per-call inputs the four reinstall entry points layer on top of the shared
 * key/entry/projectDir triple: an optional `manifest` (enables copy-failed
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
 * from `entry.commit === null`, validates the local source path when local, and
 * assembles the {@link CloneAndReinstallOptions} object (including the
 * `sourceDir: key` spread for local installs). On a failed local-path check it
 * returns `{ ok: false }` carrying the validation reason; callers map that to
 * their own presentation channel.
 */
export async function prepareReinstall(
	key: string,
	entry: ManifestEntry,
	projectDir: string,
	opts: PrepareReinstallOpts = {},
): Promise<PrepareReinstallResult> {
	const isLocal = entry.commit === null;

	if (isLocal) {
		const pathResult = await validateLocalSourcePath(key);
		if (!pathResult.valid) {
			return { ok: false, reason: pathResult.reason };
		}
	}

	const options: CloneAndReinstallOptions = {
		key,
		entry,
		projectDir,
		...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
		...(isLocal ? { sourceDir: key } : {}),
		...(opts.newRef !== undefined ? { newRef: opts.newRef } : {}),
		...(opts.newCommit !== undefined ? { newCommit: opts.newCommit } : {}),
	};

	return { ok: true, options };
}

interface CloneReinstallSuccess {
	status: "success";
	manifestEntry: ManifestEntry;
	copiedFiles: string[];
	droppedAgents: AgentId[];
}

export interface CloneReinstallFailed {
	status: "failed";
	failureReason: "clone-failed" | "copy-failed" | "unknown";
	message: string;
}

/**
 * The lenient no-agents skip: the re-cloned tree's config narrows the entry's
 * agents to zero. Per the spec's lenient agent posture this is a *skip, not a
 * failure* — the existing install is left intact, nothing is nuked, and the
 * command must NOT exit non-zero on its account. It carries its own
 * non-`failed` status so the type mirrors that intent; {@link mapCloneFailure}
 * still routes it through `onNoAgents`, preserving the exact downstream outcome.
 */
export interface CloneReinstallNoAgents {
	status: "no-agents";
	message: string;
}

/**
 * The non-success clone-reinstall outcomes: the union {@link mapCloneFailure}
 * accepts and {@link isCloneReinstallFailure} narrows to. Defined once here,
 * beside its mapper, so a new non-success status is a single-site change that
 * propagates the narrowing to every call site.
 */
export type CloneReinstallFailure =
	| CloneReinstallFailed
	| CloneReinstallNoAgents
	| CloneReinstallAborted
	| CloneReinstallBlocked;

export interface CloneFailureHandlers<T> {
	onCloneFailed: (msg: string) => T;
	onNoAgents: (msg: string) => T;
	onCopyFailed: (msg: string) => T;
	onAborted: (recordedType: "skill" | "plugin", reason: string) => T;
	onBlocked: (reason: string) => T;
	onUnknown: (msg: string) => T;
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
		result.status === "blocked" ||
		result.status === "no-agents"
	);
}

/**
 * Routes a non-success clone-reinstall result to the matching handler, using
 * `status` as the single cross-boundary discriminator for the three
 * structurally-distinct cases that leave the existing install intact:
 * `aborted` (derive-before-delete — re-cloned tree no longer supports the
 * recorded type), `blocked` (symlink-escape copy-safety — source contains a
 * link escaping the clone), and `no-agents` (lenient skip — the new config
 * narrows agents to zero; not a hard error). The remaining `failed` family is
 * refined on `failureReason` into clone-failed / copy-failed / unknown.
 */
export function mapCloneFailure<T>(
	result: CloneReinstallFailure,
	handlers: CloneFailureHandlers<T>,
): T {
	if (result.status === "aborted") {
		return handlers.onAborted(result.recordedType, result.reason);
	}
	if (result.status === "blocked") {
		return handlers.onBlocked(result.reason);
	}
	if (result.status === "no-agents") {
		return handlers.onNoAgents(result.message);
	}
	switch (result.failureReason) {
		case "clone-failed":
			return handlers.onCloneFailed(result.message);
		case "copy-failed":
			return handlers.onCopyFailed(result.message);
		case "unknown":
			return handlers.onUnknown(result.message);
	}
}

/**
 * Collapses any {@link CloneReinstallFailure} to a single user-facing message,
 * shared by the two `list` actions (update + change-version) whose failure tails
 * were otherwise byte-identical. Implemented in terms of {@link mapCloneFailure}
 * so the dispatch logic isn't re-authored: clone-failed/copy-failed/unknown and
 * the lenient no-agents skip pass through the failure's own message, `aborted`
 * routes through {@link buildAbortMessage} and `blocked` through
 * {@link buildCopySafetyMessage}. A new failure variant is a single edit here;
 * the list actions can't drift. update.ts keeps its richer per-status handler.
 */
export function failureMessage(
	result: CloneReinstallFailure,
	key: string,
): string {
	return mapCloneFailure<string>(result, {
		onCloneFailed: (msg) => msg,
		onNoAgents: (msg) => msg,
		onCopyFailed: (msg) => msg,
		onUnknown: (msg) => msg,
		onAborted: (recordedType, reason) =>
			buildAbortMessage(key, recordedType, reason),
		onBlocked: (reason) => buildCopySafetyMessage(key, reason),
	});
}

/**
 * The single source of the lenient no-agents sentence. Every site that surfaces
 * "this plugin no longer supports any installed agent" — the
 * {@link CloneReinstallNoAgents} message built in {@link runPipeline} (which
 * {@link failureMessage}'s `onNoAgents` arm then passes through) and update.ts's
 * richer warning (which appends its own remedy) — derives from here so the
 * wording can't drift across copies.
 */
export function noAgentsMessage(key: string): string {
	return `Plugin ${key} no longer supports any of your installed agents`;
}

/**
 * The unit's update was aborted by the derive-before-delete validation gate: the
 * re-cloned tree no longer supports the entry's recorded type, so no files were
 * removed and the existing install is left intact. Carries the structured cause
 * ({@link recordedType} + {@link reason}); the user-facing message and manual
 * remedy are assembled by the reporting layer. The distinct `status: "aborted"`
 * is the single discriminator: {@link mapCloneFailure} dispatches it via
 * `onAborted` on `status` alone, keeping it separate from the `status: "failed"`
 * reasons (notably copy-failed, which removes the entry) without a redundant
 * second tag.
 */
export interface CloneReinstallAborted {
	status: "aborted";
	recordedType: "skill" | "plugin";
	reason: string;
}

/**
 * The unit's update was blocked by the symlink-escape copy-safety pre-flight:
 * the re-cloned source contains a symlink whose target resolves outside the
 * clone. The scan runs BEFORE any file removal, so the existing install is left
 * fully intact (no nuke, no copy, manifest unchanged). Distinct from
 * {@link CloneReinstallAborted}: there is no recorded-type mismatch, so the
 * report must NOT offer the remove+add migrate remedy (it just re-trips the same
 * guard). The distinct `status: "blocked"` is the single discriminator;
 * {@link mapCloneFailure} dispatches it via `onBlocked` on `status` alone,
 * keeping it out of `handleCopyFailedRemoval` (which removes the entry).
 * {@link reason} carries the offending symlink; {@link buildCopySafetyMessage}
 * assembles the user-facing report.
 */
export interface CloneReinstallBlocked {
	status: "blocked";
	reason: string;
}

export type CloneReinstallResult =
	| CloneReinstallSuccess
	| CloneReinstallFailed
	| CloneReinstallNoAgents
	| CloneReinstallAborted
	| CloneReinstallBlocked;

/**
 * The user-facing report for a derive-before-delete abort: names the recorded
 * type and how the current source structure diverges from it ({@link reason}),
 * affirms the existing install is unchanged, and states the manual remove+add
 * remedy. Distinct from the copy-failed report, which tells the user the unit is
 * currently uninstalled and to re-run update — here nothing was touched.
 */
export function buildAbortMessage(
	key: string,
	recordedType: "skill" | "plugin",
	reason: string,
): string {
	return (
		`${key} was installed as a ${recordedType}, but its source no longer ` +
		`supports that type (${reason}). The existing install is unchanged. ` +
		`To migrate: npx agntc remove ${key} then npx agntc add ${key}`
	);
}

/**
 * The user-facing report for a symlink-escape copy-safety block. Names the
 * source (key), states the source contains a symlink escaping the clone (the
 * structured {@link reason} surfaces the offending link), and affirms the
 * update is blocked with the existing install left intact. Mirrors the add
 * path's identity-prefixed cancel framing (`${key}: <reason>`). Deliberately
 * distinct from {@link buildAbortMessage}: this is a copy-safety violation, not
 * a recorded-type change, so it does NOT offer the remove+add migrate remedy —
 * remove+add would only re-trip the same guard.
 */
export function buildCopySafetyMessage(key: string, reason: string): string {
	return (
		`${key}: ${reason}. The source contains a symlink escaping the clone, ` +
		`so the update is blocked. The existing install is unchanged.`
	);
}

export function formatAgentsDroppedWarning(
	key: string,
	dropped: AgentId[],
	installedAgents: AgentId[],
	newConfigAgents: AgentId[],
): string {
	return (
		`Plugin ${key} no longer declares support for ${dropped.join(", ")}. ` +
		`Currently installed for: ${installedAgents.join(", ")}. ` +
		`New version supports: ${newConfigAgents.join(", ")}.`
	);
}

export async function cloneAndReinstall(
	options: CloneAndReinstallOptions,
): Promise<CloneReinstallResult> {
	const { key, entry, projectDir } = options;

	// Local path mode: no cloning needed
	if (options.sourceDir !== undefined) {
		const result = await runPipeline({
			key,
			entry,
			projectDir,
			sourceDir: options.sourceDir,
			// Local-path mode: the provided source root is the containment
			// boundary for the symlink-escape scan (cloneRoot === sourceDir).
			cloneRoot: options.sourceDir,
			newRef: options.newRef ?? null,
			newCommit: options.newCommit ?? null,
		});
		return handleCopyFailedRemoval(result, options);
	}

	// Remote mode: clone first
	const parsed = buildParsedSourceFromKey(
		key,
		options.newRef ?? entry.ref,
		entry.cloneUrl,
	);
	let tempDir: string | undefined;

	try {
		const spin = p.spinner();
		spin.start("Cloning repository...");

		let cloneResult;
		try {
			cloneResult = await cloneSource(parsed);
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
		// Source-dir resolution for the re-cloned tree. Cycle-9 fix: PREFER the
		// entry's recorded `sourceSubpath` when present — a skills-only collection
		// member is keyed by basename (`owner/repo/<name>`) but its source actually
		// lives at `<clone>/skills/<name>`, so the key-derived dir would be wrong
		// and derive-before-delete would abort. Root-child members and standalone
		// entries (segment === basename) carry no sourceSubpath and fall back to
		// the unchanged key-derived dir, round-tripping exactly as before. (Legacy
		// pre-fix skills-only members predate the field and stay on the fallback —
		// see the known-limitation note in the report; remedy is remove + add.)
		const sourceDir = entry.sourceSubpath
			? join(tempDir, entry.sourceSubpath)
			: getSourceDirFromKey(tempDir, key);

		const result = await runPipeline({
			key,
			entry,
			projectDir,
			sourceDir,
			// Clone mode: the clone temp dir is the containment boundary for the
			// symlink-escape scan. For a member unit `sourceDir` is a subdir of
			// tempDir, so within-clone cross-member symlinks are allowed; only
			// links escaping the whole clone are rejected.
			cloneRoot: tempDir,
			newRef: options.newRef ?? null,
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
			options.projectDir,
			removeEntry(options.manifest, options.key),
		);
	}
	return result;
}

interface PipelineInput {
	key: string;
	entry: ManifestEntry;
	projectDir: string;
	sourceDir: string;
	cloneRoot: string;
	newRef: string | null;
	newCommit: string | null;
}

async function runPipeline(
	input: PipelineInput,
): Promise<CloneReinstallResult> {
	const { key, entry, projectDir, sourceDir, cloneRoot, newRef, newCommit } =
		input;

	const onWarn = (message: string) => p.log.warn(message);

	const pipelineResult = await executeNukeAndReinstall({
		key,
		sourceDir,
		cloneRoot,
		existingEntry: entry,
		projectDir,
		newRef,
		newCommit,
		onAgentsDropped: (dropped, newConfigAgents) => {
			p.log.warn(
				formatAgentsDroppedWarning(key, dropped, entry.agents, newConfigAgents),
			);
		},
		onWarn,
	});

	if (pipelineResult.status === "no-agents") {
		return {
			status: "no-agents",
			message: noAgentsMessage(key),
		};
	}

	if (pipelineResult.status === "copy-failed") {
		return {
			status: "failed",
			failureReason: "copy-failed",
			message: pipelineResult.recoveryHint,
		};
	}

	if (pipelineResult.status === "aborted") {
		return {
			status: "aborted",
			recordedType: pipelineResult.recordedType,
			reason: pipelineResult.reason,
		};
	}

	// Symlink-escape copy-safety block: like aborted, the entry stays intact (no
	// failureReason, so handleCopyFailedRemoval never removes it). Distinct status
	// keeps it off the type-migration remedy.
	if (pipelineResult.status === "blocked") {
		return {
			status: "blocked",
			reason: pipelineResult.reason,
		};
	}

	return {
		status: "success",
		manifestEntry: pipelineResult.entry,
		copiedFiles: pipelineResult.copiedFiles,
		droppedAgents: pipelineResult.droppedAgents,
	};
}
