import { join } from "node:path";
import { computeAgentChanges } from "./agent-compat.js";
import { readConfig } from "./config.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import { copyPluginAssets } from "./copy-plugin-assets.js";
import { checkEscapingSymlinks } from "./copy-safety.js";
import { getDriver } from "./drivers/registry.js";
import type { AgentId, AgentWithDriver } from "./drivers/types.js";
import { errorMessage } from "./errors.js";
import { pathExists } from "./fs-utils.js";
import { buildManifestEntry, type ManifestEntry } from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { findPresentAssetDirs } from "./type-detection.js";

export interface NukeReinstallOptions {
	key: string;
	sourceDir: string;
	/**
	 * Containment boundary for the symlink-escape pre-flight scan: the cloned
	 * repository root. For a member unit, `sourceDir` is a subdir of this root,
	 * so within-clone cross-member symlinks are allowed; only links escaping the
	 * whole clone are rejected. For local-path mode the provided source root is
	 * the boundary (`cloneRoot === sourceDir`).
	 */
	cloneRoot: string;
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

interface NukeReinstallNoAgents {
	status: "no-agents";
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

/**
 * The symlink-escape pre-flight scan found a symlink whose target resolves
 * outside the cloned repository root. This is a copy-safety/security violation,
 * NOT a recorded-type change: the scan runs BEFORE any file removal, so the
 * existing install is left fully intact (no nuke, no copy, manifest unchanged).
 * Distinct from {@link NukeReinstallAborted} — there is no recorded-type
 * mismatch here, and the remedy is NOT remove+add (that re-trips the same
 * guard). {@link reason} carries the structured cause (the offending symlink);
 * the user-facing copy-safety message is assembled by the reporting layer.
 */
interface NukeReinstallBlocked {
	status: "blocked";
	reason: string;
}

export type NukeReinstallResult =
	| NukeReinstallSuccess
	| NukeReinstallNoAgents
	| NukeReinstallCopyFailed
	| NukeReinstallAborted
	| NukeReinstallBlocked;

export async function executeNukeAndReinstall(
	options: NukeReinstallOptions,
): Promise<NukeReinstallResult> {
	const { sourceDir, cloneRoot, existingEntry, onAgentsDropped, onWarn } =
		options;

	// Symlink-escape pre-flight: scan the unit tree for any symlink pointing
	// outside the cloned repository root, BEFORE any file removal. A violation
	// returns the dedicated copy-safety `blocked` outcome with the install left
	// intact (no nuke, no copy) — sharing the derive-before-delete abort's
	// install-intact posture, but NOT its meaning: this is a copy-safety/security
	// violation, not a recorded-type change, so the reporting layer must NOT offer
	// the remove+add remedy (it re-trips the same guard). It is also NOT routed
	// through copy-failed (which removes the entry). No path-traversal guard HERE:
	// the lexical containment pre-check lives upstream in cloneAndReinstall's
	// remote branch, which calls assertSubpathWithinClone(tempDir, sourceSubpath)
	// before the join (analysis 10-2). It originally lived nowhere because update
	// replayed only a key-derived subdir (getSourceDirFromKey, not a fresh
	// source-supplied selector); cycle-9 added `sourceSubpath` as a second
	// source-derived path component fed into that join, so it now gets add's
	// step-2c lexical guard too, restoring copy-safety symmetry. By the time the
	// pipeline runs, `sourceDir` is already confirmed lexically contained; the
	// symlink scan below remains the content-validation half of the pre-flight.
	const symlinkCheck = await checkEscapingSymlinks(sourceDir, cloneRoot);
	if (!symlinkCheck.ok) {
		return {
			status: "blocked",
			reason: symlinkCheck.message,
		};
	}

	const ref = options.newRef !== undefined ? options.newRef : existingEntry.ref;
	const commit =
		options.newCommit !== undefined ? options.newCommit : existingEntry.commit;

	// Read config from source. Under configless replay a missing config is normal
	// (recorded units carry no agntc.json): null means "no agent restriction"
	// (effective agents unchanged), not abort. Both recorded skills and recorded
	// plugins replay by their persisted type, so neither bails on null config — the
	// type is authoritative and is never re-derived from a present/absent config.
	const config = await readConfig(sourceDir, { onWarn });

	// The recorded type selects the replay predicate. 4-3 backfills `type` on
	// manifest read, so every entry reaching the pipeline in production carries a
	// concrete type; the `?? "skill"` is a defensive, non-throwing fallback for a
	// typeless entry (the lenient single-skill default, matching the backfill's own
	// derivation rule). The type is recorded, never re-derived from the clone.
	const recordedType: "skill" | "plugin" = existingEntry.type ?? "skill";

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

	return recordedType === "skill"
		? replayRecordedSkill(ctx)
		: replayRecordedPlugin(ctx);
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
 * Derive-before-delete replay for a recorded `plugin`: at least one asset-kind
 * dir (`skills`/`agents`/`hooks`) must still exist in the re-cloned tree. The
 * scan runs BEFORE nuking; zero present dirs (the unit is now a bare skill or a
 * members collection) aborts with the install left intact. The recorded type is
 * authoritative — the scan only chooses *which* present dirs to copy, never
 * re-derives the type, so a benign newly-added asset dir is picked up and an
 * added root SKILL.md is ignored while any asset dir remains.
 */
async function replayRecordedPlugin(
	ctx: ReplayContext,
): Promise<NukeReinstallResult> {
	const { options, agents } = ctx;
	const { sourceDir, projectDir, existingEntry } = options;

	const presentAssetDirs = await findPresentAssetDirs(sourceDir);

	if (presentAssetDirs.length === 0) {
		return {
			status: "aborted",
			recordedType: "plugin",
			reason:
				"recorded as plugin but no asset dir (skills/agents/hooks) remains in the source",
		};
	}

	await nukeManifestFiles(projectDir, existingEntry.files);

	let copiedFiles: string[];
	try {
		const pluginResult = await copyPluginAssets({
			sourceDir,
			assetDirs: presentAssetDirs,
			agents,
			projectDir,
		});
		copiedFiles = pluginResult.copiedFiles;
	} catch (err: unknown) {
		return copyFailed(options.key, err);
	}

	return buildSuccess(ctx, copiedFiles, "plugin");
}

type AgentResolution =
	| { status: "ok"; effectiveAgents: AgentId[]; droppedAgents: AgentId[] }
	| { status: "no-agents" };

/**
 * Resolves the effective agent set. Both an absent config (no agntc.json →
 * `undefined`) AND a defined-but-empty `agents` array impose no restriction — the
 * entry's recorded agents are kept unchanged. An empty array carries no usable
 * author intent (the spec's lenient "no valid constraint" case), so it is treated
 * identically to no config at all, matching the `add` path. Only a non-empty
 * config narrows to the intersection; dropping every recorded agent there is a
 * genuine no-agents failure.
 */
export function resolveAgents(
	entryAgents: AgentId[],
	configAgents: AgentId[] | undefined,
): AgentResolution {
	if (configAgents === undefined || configAgents.length === 0) {
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

	const entry = buildManifestEntry({
		ref: ref ?? null,
		commit: commit ?? null,
		agents: effectiveAgents,
		files: copiedFiles,
		type,
		cloneUrl: existingEntry.cloneUrl ?? null,
		constraint: existingEntry.constraint,
		// Preserve the divergent source subpath (cycle-9): identity is unchanged
		// by an update, so a skills-only member keyed by basename keeps pointing at
		// its `skills/<name>` source. Dropping it here would silently re-break the
		// NEXT update (the resolver would fall back to the wrong key-derived dir).
		sourceSubpath: existingEntry.sourceSubpath,
	});

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
