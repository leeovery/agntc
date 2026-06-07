import { join } from "node:path";
import { computeAgentChanges } from "./agent-compat.js";
import { readConfig } from "./config.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import { copyPluginAssets } from "./copy-plugin-assets.js";
import { getDriver } from "./drivers/registry.js";
import type { AgentId, AgentWithDriver } from "./drivers/types.js";
import { errorMessage } from "./errors.js";
import { pathExists } from "./fs-utils.js";
import type { ManifestEntry } from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { detectType } from "./type-detection.js";

export interface NukeReinstallOptions {
	key: string;
	sourceDir: string;
	existingEntry: ManifestEntry;
	projectDir: string;
	newRef?: string | null;
	newCommit?: string | null;
	onAgentsDropped?: (dropped: AgentId[], newConfigAgents: AgentId[]) => void;
	onWarn?: (message: string) => void;
}

interface NukeReinstallSuccess {
	status: "success";
	entry: ManifestEntry;
	copiedFiles: string[];
	droppedAgents: AgentId[];
}

interface NukeReinstallNoConfig {
	status: "no-config";
}

interface NukeReinstallNoAgents {
	status: "no-agents";
}

interface NukeReinstallInvalidType {
	status: "invalid-type";
}

interface NukeReinstallCopyFailed {
	status: "copy-failed";
	errorMessage: string;
	recoveryHint: string;
}

/**
 * The re-cloned tree no longer supports the entry's *recorded* type, detected by
 * the derive-before-delete validation gate *before* any file removal. The
 * existing install is left intact. {@link recordedType} and {@link reason} carry
 * the structured cause; the user-facing message + remedy are assembled by the
 * reporting layer.
 */
interface NukeReinstallAborted {
	status: "aborted";
	recordedType: "skill" | "plugin";
	reason: string;
}

export type NukeReinstallResult =
	| NukeReinstallSuccess
	| NukeReinstallNoConfig
	| NukeReinstallNoAgents
	| NukeReinstallInvalidType
	| NukeReinstallCopyFailed
	| NukeReinstallAborted;

export async function executeNukeAndReinstall(
	options: NukeReinstallOptions,
): Promise<NukeReinstallResult> {
	const { sourceDir, existingEntry, onAgentsDropped, onWarn } = options;

	const ref = options.newRef !== undefined ? options.newRef : existingEntry.ref;
	const commit =
		options.newCommit !== undefined ? options.newCommit : existingEntry.commit;

	// Read config from source. Under configless replay, a missing config is
	// normal (recorded skills carry no agntc.json): null means "no agent
	// restriction" (effective agents unchanged), not abort. Legacy/plugin entries
	// (type derivation reworked in 4-5) still treat a missing config as a failure.
	const config = await readConfig(sourceDir, { onWarn });

	if (config === null && existingEntry.type !== "skill") {
		return { status: "no-config" };
	}

	const agentResolution = resolveAgents(existingEntry.agents, config?.agents);
	if (agentResolution.status === "no-agents") {
		return { status: "no-agents" };
	}
	const { effectiveAgents, droppedAgents } = agentResolution;

	if (config !== null && droppedAgents.length > 0) {
		onAgentsDropped?.(droppedAgents, config.agents);
	}

	const agents = effectiveAgents.map((id) => ({
		id,
		driver: getDriver(id),
	}));

	const ctx: ReplayContext = {
		options,
		agents,
		effectiveAgents,
		droppedAgents,
		ref,
		commit,
	};

	if (existingEntry.type === "skill") {
		return replayRecordedSkill(ctx);
	}

	// Recorded plugin (and legacy fallthrough) — type derivation reworked in 4-5.
	return replayViaDetection(ctx);
}

interface ReplayContext {
	options: NukeReinstallOptions;
	agents: AgentWithDriver[];
	effectiveAgents: AgentId[];
	droppedAgents: AgentId[];
	ref: string | null;
	commit: string | null;
}

/**
 * Derive-before-delete replay for a recorded `skill`: the unit's root `SKILL.md`
 * must still exist in the re-cloned tree. Validation runs BEFORE nuking; on
 * failure the install is left intact (aborted). When present, re-copy the unit
 * dir via copyBareSkill — the recorded type is authoritative, so any
 * newly-added asset dirs are ignored (not re-derived into a plugin).
 */
async function replayRecordedSkill(
	ctx: ReplayContext,
): Promise<NukeReinstallResult> {
	const { options, agents } = ctx;
	const { sourceDir, projectDir, existingEntry } = options;

	const skillMdExists = await pathExists(join(sourceDir, "SKILL.md"));
	if (!skillMdExists) {
		return {
			status: "aborted",
			recordedType: "skill",
			reason:
				"recorded as a bare skill, but SKILL.md is no longer present in the source",
		};
	}

	await nukeManifestFiles(projectDir, existingEntry.files);

	let copiedFiles: string[];
	try {
		const bareResult = await copyBareSkill({ sourceDir, projectDir, agents });
		copiedFiles = bareResult.copiedFiles;
	} catch (err: unknown) {
		return copyFailed(options.key, err);
	}

	return buildSuccess(ctx, copiedFiles, "skill");
}

/**
 * Legacy detection-based path retained for recorded `plugin` entries until the
 * plugin derive-before-delete predicate lands (4-5). Does not gate on SKILL.md.
 */
async function replayViaDetection(
	ctx: ReplayContext,
): Promise<NukeReinstallResult> {
	const { options, agents } = ctx;
	const { sourceDir, projectDir, existingEntry, onWarn } = options;

	const detected = await detectType(sourceDir, { onWarn });
	if (detected.type === "not-agntc" || detected.type === "collection") {
		return { status: "invalid-type" };
	}

	await nukeManifestFiles(projectDir, existingEntry.files);

	let copiedFiles: string[];
	try {
		if (detected.type === "plugin") {
			const pluginResult = await copyPluginAssets({
				sourceDir,
				assetDirs: detected.assetDirs,
				agents,
				projectDir,
			});
			copiedFiles = pluginResult.copiedFiles;
		} else {
			const bareResult = await copyBareSkill({ sourceDir, projectDir, agents });
			copiedFiles = bareResult.copiedFiles;
		}
	} catch (err: unknown) {
		return copyFailed(options.key, err);
	}

	return buildSuccess(
		ctx,
		copiedFiles,
		detected.type === "plugin" ? "plugin" : "skill",
	);
}

type AgentResolution =
	| { status: "ok"; effectiveAgents: AgentId[]; droppedAgents: AgentId[] }
	| { status: "no-agents" };

/**
 * Resolves the effective agent set. A null config (no agntc.json) imposes no
 * restriction — the entry's recorded agents are kept unchanged. A present config
 * narrows to the intersection; dropping every agent is a no-agents failure.
 */
function resolveAgents(
	entryAgents: AgentId[],
	configAgents: AgentId[] | undefined,
): AgentResolution {
	if (configAgents === undefined) {
		return { status: "ok", effectiveAgents: entryAgents, droppedAgents: [] };
	}

	const { effective, dropped } = computeAgentChanges(entryAgents, configAgents);
	if (effective.length === 0) {
		return { status: "no-agents" };
	}
	return { status: "ok", effectiveAgents: effective, droppedAgents: dropped };
}

function buildSuccess(
	ctx: ReplayContext,
	copiedFiles: string[],
	type: "skill" | "plugin",
): NukeReinstallSuccess {
	const { options, effectiveAgents, droppedAgents, ref, commit } = ctx;
	const { existingEntry } = options;

	const entry: ManifestEntry = {
		ref: ref ?? null,
		commit: commit ?? null,
		installedAt: new Date().toISOString(),
		agents: effectiveAgents,
		files: copiedFiles,
		type,
		cloneUrl: existingEntry.cloneUrl ?? null,
		...(existingEntry.constraint !== undefined && {
			constraint: existingEntry.constraint,
		}),
	};

	return {
		status: "success",
		entry,
		copiedFiles,
		droppedAgents,
	};
}

function copyFailed(key: string, err: unknown): NukeReinstallCopyFailed {
	return {
		status: "copy-failed",
		errorMessage: errorMessage(err),
		recoveryHint:
			`Update failed for ${key} after removing old files. ` +
			`The plugin is currently uninstalled. ` +
			`Run \`npx agntc update ${key}\` to retry installation.`,
	};
}
