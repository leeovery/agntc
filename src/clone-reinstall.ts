import * as p from "@clack/prompts";
import type { AgentId } from "./drivers/types.js";
import { errorMessage } from "./errors.js";
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

interface CloneReinstallSuccess {
	status: "success";
	manifestEntry: ManifestEntry;
	copiedFiles: string[];
	droppedAgents: AgentId[];
}

export interface CloneReinstallFailed {
	status: "failed";
	failureReason: "clone-failed" | "no-agents" | "copy-failed" | "unknown";
	message: string;
}

export interface CloneFailureHandlers<T> {
	onCloneFailed: (msg: string) => T;
	onNoAgents: (msg: string) => T;
	onCopyFailed: (msg: string) => T;
	onAborted: (recordedType: "skill" | "plugin", reason: string) => T;
	onUnknown: (msg: string) => T;
}

export function mapCloneFailure<T>(
	result: CloneReinstallFailed | CloneReinstallAborted,
	handlers: CloneFailureHandlers<T>,
): T {
	switch (result.failureReason) {
		case "clone-failed":
			return handlers.onCloneFailed(result.message);
		case "no-agents":
			return handlers.onNoAgents(result.message);
		case "copy-failed":
			return handlers.onCopyFailed(result.message);
		case "aborted":
			return handlers.onAborted(result.recordedType, result.reason);
		case "unknown":
			return handlers.onUnknown(result.message);
	}
}

export function buildFailureMessage(
	result: CloneReinstallFailed,
	key: string,
): string {
	switch (result.failureReason) {
		case "no-agents":
			return `Plugin ${key} no longer supports any of your installed agents`;
		case "clone-failed":
		case "copy-failed":
		case "unknown":
			return result.message;
	}
}

/**
 * The unit's update was aborted by the derive-before-delete validation gate: the
 * re-cloned tree no longer supports the entry's recorded type, so no files were
 * removed and the existing install is left intact. Carries the structured cause
 * ({@link recordedType} + {@link reason}); the user-facing message and manual
 * remedy are assembled by the reporting layer. The `failureReason: "aborted"`
 * discriminator lets {@link mapCloneFailure} dispatch it via `onAborted` while
 * the distinct `status: "aborted"` keeps it from being conflated with the
 * `status: "failed"` reasons (notably copy-failed, which removes the entry).
 */
export interface CloneReinstallAborted {
	status: "aborted";
	failureReason: "aborted";
	recordedType: "skill" | "plugin";
	reason: string;
}

export type CloneReinstallResult =
	| CloneReinstallSuccess
	| CloneReinstallFailed
	| CloneReinstallAborted;

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
		const sourceDir = getSourceDirFromKey(tempDir, key);

		const result = await runPipeline({
			key,
			entry,
			projectDir,
			sourceDir,
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
	newRef: string | null;
	newCommit: string | null;
}

async function runPipeline(
	input: PipelineInput,
): Promise<CloneReinstallResult> {
	const { key, entry, projectDir, sourceDir, newRef, newCommit } = input;

	const onWarn = (message: string) => p.log.warn(message);

	const pipelineResult = await executeNukeAndReinstall({
		key,
		sourceDir,
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
			status: "failed",
			failureReason: "no-agents",
			message: `Plugin ${key} no longer supports any of your installed agents`,
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
			failureReason: "aborted",
			recordedType: pipelineResult.recordedType,
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
