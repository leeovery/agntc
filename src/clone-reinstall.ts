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
	failureReason:
		| "clone-failed"
		| "no-config"
		| "no-agents"
		| "invalid-type"
		| "copy-failed"
		| "unknown";
	message: string;
}

export interface CloneFailureHandlers<T> {
	onCloneFailed: (msg: string) => T;
	onNoConfig: (msg: string) => T;
	onNoAgents: (msg: string) => T;
	onInvalidType: (msg: string) => T;
	onCopyFailed: (msg: string) => T;
	onUnknown: (msg: string) => T;
}

export function mapCloneFailure<T>(
	result: CloneReinstallFailed,
	handlers: CloneFailureHandlers<T>,
): T {
	switch (result.failureReason) {
		case "clone-failed":
			return handlers.onCloneFailed(result.message);
		case "no-config":
			return handlers.onNoConfig(result.message);
		case "no-agents":
			return handlers.onNoAgents(result.message);
		case "invalid-type":
			return handlers.onInvalidType(result.message);
		case "copy-failed":
			return handlers.onCopyFailed(result.message);
		case "unknown":
			return handlers.onUnknown(result.message);
	}
}

export function buildFailureMessage(
	result: CloneReinstallFailed,
	key: string,
	opts?: { isChangeVersion?: boolean },
): string {
	const prefix = opts?.isChangeVersion ? `New version of ${key}` : key;
	switch (result.failureReason) {
		case "no-config":
			return `${prefix} has no agntc.json`;
		case "no-agents":
			return `Plugin ${key} no longer supports any of your installed agents`;
		case "invalid-type":
			return `${prefix} is not a valid plugin`;
		case "clone-failed":
		case "copy-failed":
		case "unknown":
			return result.message;
	}
}

export type CloneReinstallResult = CloneReinstallSuccess | CloneReinstallFailed;

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

	if (pipelineResult.status === "no-config") {
		return {
			status: "failed",
			failureReason: "no-config",
			message: `${key} has no agntc.json`,
		};
	}

	if (pipelineResult.status === "no-agents") {
		return {
			status: "failed",
			failureReason: "no-agents",
			message: `Plugin ${key} no longer supports any of your installed agents`,
		};
	}

	if (pipelineResult.status === "invalid-type") {
		return {
			status: "failed",
			failureReason: "invalid-type",
			message: `${key} is not a valid plugin`,
		};
	}

	if (pipelineResult.status === "copy-failed") {
		return {
			status: "failed",
			failureReason: "copy-failed",
			message: pipelineResult.recoveryHint,
		};
	}

	return {
		status: "success",
		manifestEntry: pipelineResult.entry,
		copiedFiles: pipelineResult.copiedFiles,
		droppedAgents: pipelineResult.droppedAgents,
	};
}
