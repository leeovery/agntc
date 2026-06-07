import { join } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { selectAgents } from "../agent-select.js";
import { selectCollectionPlugins } from "../collection-select.js";
import { checkFileCollisions } from "../collision-check.js";
import { resolveCollisions } from "../collision-resolve.js";
import { computeIncomingFiles } from "../compute-incoming-files.js";
import type { AgntcConfig } from "../config.js";
import { readConfig } from "../config.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import type { AssetCounts } from "../copy-plugin-assets.js";
import { copyPluginAssets } from "../copy-plugin-assets.js";
import { detectAgents } from "../detect-agents.js";
import { getDriver } from "../drivers/registry.js";
import type { AgentId, AgentWithDriver } from "../drivers/types.js";
import { errorMessage } from "../errors.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { cleanupTempDir, cloneSource } from "../git-clone.js";
import { fetchRemoteTags } from "../git-utils.js";
import type { Manifest } from "../manifest.js";
import {
	addEntry,
	manifestTypeFromDetected,
	readManifest,
	writeManifest,
} from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { parseSource, resolveCloneUrl } from "../source-parser.js";
import type { PluginInstallResult } from "../summary.js";
import { renderAddSummary, renderCollectionAddSummary } from "../summary.js";
import type { DetectedType } from "../type-detection.js";
import { detectType, TypeConflictError } from "../type-detection.js";
import { checkUnmanagedConflicts } from "../unmanaged-check.js";
import type { UnmanagedPluginConflicts } from "../unmanaged-resolve.js";
import { resolveUnmanagedConflicts } from "../unmanaged-resolve.js";
import { resolveLatestVersion, resolveVersion } from "../version-resolve.js";

function deriveCloneUrlForManifest(
	parsed: Awaited<ReturnType<typeof parseSource>>,
): string | null {
	if (parsed.type === "local-path") return null;
	return resolveCloneUrl(parsed);
}

interface TagResolutionResult {
	parsed: Awaited<ReturnType<typeof parseSource>>;
	constraint: string | undefined;
}

export async function resolveTagConstraint(
	parsed: Awaited<ReturnType<typeof parseSource>>,
): Promise<TagResolutionResult> {
	if (parsed.type === "local-path") {
		return { parsed, constraint: undefined };
	}

	let updatedParsed = parsed;
	let derivedConstraint: string | undefined;
	const url = resolveCloneUrl(updatedParsed);

	if (updatedParsed.ref === null && updatedParsed.constraint === null) {
		// Bare add: resolve latest semver tag and auto-apply constraint
		const tags = await fetchRemoteTags(url);
		const latest = resolveLatestVersion(tags);
		if (latest !== null) {
			derivedConstraint = `^${latest.version}`;
			updatedParsed = { ...updatedParsed, ref: latest.tag };
		}
	} else if (updatedParsed.constraint != null) {
		// Explicit constraint: resolve best matching tag within bounds
		const tags = await fetchRemoteTags(url);
		const resolved = resolveVersion(updatedParsed.constraint, tags);
		if (resolved === null) {
			throw new Error(
				`No tags satisfy constraint ${updatedParsed.constraint} for ${updatedParsed.manifestKey}`,
			);
		}
		updatedParsed = { ...updatedParsed, ref: resolved.tag };
	}

	const constraint = updatedParsed.constraint ?? derivedConstraint;
	return { parsed: updatedParsed, constraint: constraint ?? undefined };
}

interface ConflictCheckResult {
	updatedManifest: Manifest;
	proceed: boolean;
}

async function runConflictChecks(opts: {
	incomingFiles: string[];
	manifest: Manifest;
	pluginKey: string;
	projectDir: string;
}): Promise<ConflictCheckResult> {
	const { incomingFiles, pluginKey, projectDir } = opts;
	let currentManifest = opts.manifest;

	// Collision check
	const collisions = checkFileCollisions(
		incomingFiles,
		currentManifest,
		pluginKey,
	);
	if (collisions.size > 0) {
		const resolution = await resolveCollisions(
			collisions,
			currentManifest,
			projectDir,
		);
		currentManifest = resolution.updatedManifest;
		if (!resolution.resolved) {
			return { updatedManifest: currentManifest, proceed: false };
		}
	}

	// Unmanaged check
	const unmanagedConflicts = await checkUnmanagedConflicts(
		incomingFiles,
		currentManifest,
		projectDir,
	);
	if (unmanagedConflicts.length > 0) {
		const conflicts: UnmanagedPluginConflicts[] = [
			{ pluginKey, files: unmanagedConflicts },
		];
		const unmanagedResolution = await resolveUnmanagedConflicts(conflicts);
		if (unmanagedResolution.cancelled.length > 0) {
			return { updatedManifest: currentManifest, proceed: false };
		}
	}

	return { updatedManifest: currentManifest, proceed: true };
}

export async function runAdd(
	source: string,
	options?: { forcePlugin?: boolean },
): Promise<void> {
	p.intro("agntc add");

	let tempDir: string | undefined;

	try {
		// 1. Parse source and resolve tag constraint
		const rawParsed = await parseSource(source);
		const resolution = await resolveTagConstraint(rawParsed);
		const parsed = resolution.parsed;
		const resolvedConstraint = resolution.constraint;

		// 2. Resolve source directory and commit
		const spin = p.spinner();
		let sourceDir: string;
		let commit: string | null;

		if (parsed.type === "local-path") {
			sourceDir = parsed.resolvedPath;
			commit = null;
		} else {
			spin.start("Cloning repository...");
			let cloneResult;
			try {
				cloneResult = await cloneSource(parsed);
			} catch (err) {
				spin.stop("Clone failed");
				throw err;
			}
			spin.stop("Cloned successfully");
			tempDir = cloneResult.tempDir;
			sourceDir = cloneResult.tempDir;
			commit = cloneResult.commit;
		}

		// 2b. Resolve the unit directory. For a direct-path (tree URL) source the
		// subpath is a standalone unit selector: detection, config, and copy all
		// target join(sourceDir, parsed.targetPlugin), not the repo root (task
		// 2-3). Every other source has unitDir === sourceDir (no-op). The
		// within-clone path-traversal/containment guard for targetPlugin is
		// EXPLICITLY DEFERRED TO PHASE 5.
		const unitDir =
			parsed.type === "direct-path"
				? join(sourceDir, parsed.targetPlugin)
				: sourceDir;

		// 3. Read config (lenient — never throws; null when absent/empty)
		const onWarn = (message: string) => p.log.warn(message);
		const config = await readConfig(unitDir, { onWarn });

		// 4. Detect type ONCE — structure is sole authority; optional root config
		// type and the --plugin installer override are forwarded so detection owns
		// recognition and conflict resolution (Phase 1, task 1-4).
		let detected: DetectedType;
		try {
			detected = await detectType(unitDir, {
				onWarn,
				configType: config?.type,
				forcePlugin: options?.forcePlugin,
			});
		} catch (err) {
			if (err instanceof TypeConflictError) {
				// Detector supplies the structural half; prepend the source identity
				// so the message names the offending source (spec: hard errors name
				// the source). Pre-flight, non-zero, before any copy/manifest write.
				p.cancel(
					`${parsed.manifestKey} declares type plugin but ${err.message}`,
				);
				throw new ExitSignal(1);
			}
			throw err;
		}

		// 5. Branch on detected type
		if (detected.type === "collection") {
			await runCollectionPipeline({
				sourceDir: unitDir,
				parsed,
				commit,
				detected,
				onWarn,
				spin,
				constraint: resolvedConstraint,
			});
			return;
		}

		if (detected.type === "not-agntc") {
			// Loud non-zero pre-flight failure (spec: Error & Abort — Hard errors).
			p.cancel(
				`${parsed.manifestKey}: Not an agntc source — no SKILL.md, asset dirs, or collection members found`,
			);
			throw new ExitSignal(1);
		}

		// 7. Detect agents
		const projectDir = process.cwd();
		const detectedAgents = await detectAgents(projectDir);

		// 8. Select agents
		const selectedAgents = await selectAgents({
			declaredAgents: config?.agents ?? [],
			detectedAgents,
		});

		if (selectedAgents.length === 0) {
			p.cancel("Cancelled — no agents selected");
			throw new ExitSignal(0);
		}

		// 9. Build agent+driver pairs for copy
		const agents = selectedAgents.map((id) => ({
			id,
			driver: getDriver(id),
		}));

		// 10. Read manifest and nuke existing files if reinstalling
		const manifest = await readManifest(projectDir);
		const existingEntry = manifest[parsed.manifestKey];
		if (existingEntry) {
			await nukeManifestFiles(projectDir, existingEntry.files);
		}

		// 10a. Compute incoming files (against the resolved unit directory)
		const incomingFiles = await computeIncomingFiles(
			detected.type === "plugin"
				? {
						type: "plugin",
						sourceDir: unitDir,
						assetDirs: detected.assetDirs,
						agents,
					}
				: { type: "bare-skill", sourceDir: unitDir, agents },
		);

		// 10b. Collision + unmanaged conflict checks
		const conflictResult = await runConflictChecks({
			incomingFiles,
			manifest,
			pluginKey: parsed.manifestKey,
			projectDir,
		});
		const currentManifest = conflictResult.updatedManifest;
		if (!conflictResult.proceed) {
			p.cancel("Cancelled — conflict not resolved");
			throw new ExitSignal(0);
		}

		// 11. Copy assets (with spinner)
		let copiedFiles: string[];
		let assetCountsByAgent: Partial<Record<AgentId, AssetCounts>> | undefined;

		spin.start("Copying skill files...");
		try {
			if (detected.type === "plugin") {
				const pluginResult = await copyPluginAssets({
					sourceDir: unitDir,
					assetDirs: detected.assetDirs,
					agents,
					projectDir,
				});
				copiedFiles = pluginResult.copiedFiles;
				assetCountsByAgent = pluginResult.assetCountsByAgent;
			} else {
				const bareResult = await copyBareSkill({
					sourceDir: unitDir,
					projectDir,
					agents,
				});
				copiedFiles = bareResult.copiedFiles;
			}
		} catch (err) {
			spin.stop("Copy failed");
			throw err;
		}
		spin.stop("Copied successfully");

		// 12. Handle empty plugin
		if (detected.type === "plugin" && copiedFiles.length === 0) {
			p.log.warn("No files to install");
			throw new ExitSignal(0);
		}

		// 13. Write manifest
		const entry = {
			ref: parsed.ref,
			commit,
			installedAt: new Date().toISOString(),
			agents: selectedAgents,
			files: copiedFiles,
			type: manifestTypeFromDetected(detected.type),
			cloneUrl: deriveCloneUrlForManifest(parsed),
			...(resolvedConstraint != null && { constraint: resolvedConstraint }),
		};
		const updated = addEntry(currentManifest, parsed.manifestKey, entry);
		await writeManifest(projectDir, updated);

		// 14. Summary
		p.outro(
			renderAddSummary({
				manifestKey: parsed.manifestKey,
				ref: parsed.ref,
				commit,
				detectedType: detected.type,
				selectedAgents,
				assetCountsByAgent,
				copiedFiles,
			}),
		);
	} catch (err) {
		if (err instanceof ExitSignal) {
			throw err;
		}
		p.cancel(errorMessage(err));
		throw new ExitSignal(1);
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

interface CollectionPipelineInput {
	sourceDir: string;
	parsed: Awaited<ReturnType<typeof parseSource>>;
	commit: string | null;
	detected: Extract<DetectedType, { type: "collection" }>;
	onWarn: (message: string) => void;
	spin: ReturnType<typeof p.spinner>;
	constraint: string | undefined;
}

async function runCollectionPipeline(
	input: CollectionPipelineInput,
): Promise<void> {
	const { sourceDir, parsed, commit, detected, onWarn, spin, constraint } =
		input;
	const projectDir = process.cwd();

	// 1. Read manifest
	const manifest = await readManifest(projectDir);

	// 2. Select plugins (or use targetPlugin for direct-path)
	let selectedPlugins: string[];

	if (parsed.type === "direct-path") {
		if (!detected.plugins.includes(parsed.targetPlugin)) {
			throw new Error(
				`Plugin "${parsed.targetPlugin}" not found in collection. Available: ${detected.plugins.join(", ")}`,
			);
		}
		selectedPlugins = [parsed.targetPlugin];
	} else {
		selectedPlugins = await selectCollectionPlugins({
			plugins: detected.plugins,
			manifest,
			manifestKeyPrefix: parsed.manifestKey,
		});

		if (selectedPlugins.length === 0) {
			p.cancel("Cancelled — no plugins selected");
			throw new ExitSignal(0);
		}
	}

	// 3. Read each selected member's config ONLY for its declared agents. The
	// member set is selectedPlugins (populated structurally upstream via Phase 1
	// qualifiesAsMember) — config presence is NOT membership. readConfig is total:
	// it returns AgntcConfig for a valid config and null for a missing or unusable
	// one (a legitimate configless member, never a skip reason). It never throws for
	// config problems; only a genuine non-ENOENT IO error propagates, and that
	// SHOULD abort the whole pipeline (surfaced via runAdd's outer catch). Agent
	// resolution is per-member (step 5a): each member runs the Phase 1 selectAgents
	// contract against its own declared ceiling, so there is no cross-member union.
	const pluginConfigs = new Map<string, AgntcConfig | null>();

	for (const pluginName of selectedPlugins) {
		const pluginDir = join(sourceDir, pluginName);
		const pluginConfig = await readConfig(pluginDir, { onWarn });
		pluginConfigs.set(pluginName, pluginConfig);
	}

	// 4. Detect agents once for the whole collection (member-independent signal
	// used to pre-tick options in every per-member prompt).
	const detectedAgents = await detectAgents(projectDir);

	// 5. Per-plugin conflict checks + install
	const results: PluginInstallResult[] = [];
	let currentManifest: Manifest = manifest;

	// 5a. Per-plugin conflict resolution (before any copying)
	const pluginsToInstall: Array<{
		pluginName: string;
		pluginDir: string;
		pluginDetected: Extract<DetectedType, { type: "bare-skill" | "plugin" }>;
		pluginManifestKey: string;
		pluginAgents: AgentId[];
		pluginAgentDrivers: AgentWithDriver[];
	}> = [];

	for (const pluginName of selectedPlugins) {
		// Every selected member is present in the map after step 3 (readConfig is
		// total — it never throws for config problems, so no member is ever absent).
		// A null config is a legitimate configless member that proceeds via the
		// configless default; it is never a skip reason here.
		const pluginConfig = pluginConfigs.get(pluginName) ?? null;

		const pluginDir = join(sourceDir, pluginName);
		const pluginDetected = await detectType(pluginDir, {
			onWarn,
		});

		if (pluginDetected.type === "not-agntc") {
			onWarn(`${pluginName}: not a valid agntc plugin — skipping`);
			results.push({
				pluginName,
				status: "skipped",
				copiedFiles: [],
				agents: [],
			});
			continue;
		}

		if (pluginDetected.type === "collection") {
			onWarn(`${pluginName}: nested collections not supported — skipping`);
			results.push({
				pluginName,
				status: "skipped",
				copiedFiles: [],
				agents: [],
			});
			continue;
		}

		// Per-member agent resolution via the Phase 1 selectAgents contract. A
		// config-bearing member passes its declared ceiling; a configless member
		// (null config) passes [] -> KNOWN_AGENTS default (all three, detected
		// pre-ticked, always prompt, no auto-select). Each member resolves
		// independently — no union, no cross-member coupling.
		const pluginAgents = await selectAgents({
			declaredAgents: pluginConfig?.agents ?? [],
			detectedAgents,
		});
		// Zero resolution (declared ceiling matched nothing, or the installer
		// deselected all in the configless default) is a silent per-member skip:
		// no copy, no manifest entry, no warning, absent from summary.
		if (pluginAgents.length === 0) continue;
		const pluginAgentDrivers: AgentWithDriver[] = pluginAgents.map((id) => ({
			id,
			driver: getDriver(id),
		}));

		// Nuke existing files if reinstalling this plugin
		const pluginManifestKey =
			parsed.type === "direct-path"
				? parsed.manifestKey
				: `${parsed.manifestKey}/${pluginName}`;
		const existingPluginEntry = currentManifest[pluginManifestKey];
		if (existingPluginEntry) {
			try {
				await nukeManifestFiles(projectDir, existingPluginEntry.files);
			} catch {
				onWarn(`${pluginName}: failed to remove old files — skipping`);
				results.push({
					pluginName,
					status: "skipped",
					copiedFiles: [],
					agents: [],
				});
				continue;
			}
		}

		// Compute incoming files
		const incomingFiles = await computeIncomingFiles(
			pluginDetected.type === "plugin"
				? {
						type: "plugin",
						sourceDir: pluginDir,
						assetDirs: pluginDetected.assetDirs,
						agents: pluginAgentDrivers,
					}
				: {
						type: "bare-skill",
						sourceDir: pluginDir,
						agents: pluginAgentDrivers,
					},
		);

		// Collision + unmanaged conflict checks
		const conflictResult = await runConflictChecks({
			incomingFiles,
			manifest: currentManifest,
			pluginKey: pluginManifestKey,
			projectDir,
		});
		currentManifest = conflictResult.updatedManifest;
		if (!conflictResult.proceed) {
			results.push({
				pluginName,
				status: "skipped",
				copiedFiles: [],
				agents: [],
			});
			continue;
		}

		pluginsToInstall.push({
			pluginName,
			pluginDir,
			pluginDetected,
			pluginManifestKey,
			pluginAgents,
			pluginAgentDrivers,
		});
	}

	// 5b. Copy all approved plugins (independent failure handling)
	spin.start("Copying skill files...");
	for (const {
		pluginName,
		pluginDir,
		pluginDetected,
		pluginAgents,
		pluginAgentDrivers,
	} of pluginsToInstall) {
		try {
			if (pluginDetected.type === "plugin") {
				const pluginResult = await copyPluginAssets({
					sourceDir: pluginDir,
					assetDirs: pluginDetected.assetDirs,
					agents: pluginAgentDrivers,
					projectDir,
				});
				results.push({
					pluginName,
					status: "installed",
					copiedFiles: pluginResult.copiedFiles,
					agents: pluginAgents,
					assetCountsByAgent: pluginResult.assetCountsByAgent,
					detectedType: pluginDetected,
				});
			} else {
				// bare-skill
				const bareResult = await copyBareSkill({
					sourceDir: pluginDir,
					projectDir,
					agents: pluginAgentDrivers,
				});
				results.push({
					pluginName,
					status: "installed",
					copiedFiles: bareResult.copiedFiles,
					agents: pluginAgents,
					detectedType: pluginDetected,
				});
			}
		} catch (err) {
			results.push({
				pluginName,
				status: "failed",
				copiedFiles: [],
				agents: [],
				errorMessage: errorMessage(err),
			});
		}
	}
	spin.stop("Copied");

	// 6. Single manifest write
	let updatedManifest: Manifest = currentManifest;
	for (const result of results) {
		if (result.status !== "installed") continue;
		const manifestKey =
			parsed.type === "direct-path"
				? parsed.manifestKey
				: `${parsed.manifestKey}/${result.pluginName}`;
		const entry = {
			ref: parsed.ref,
			commit,
			installedAt: new Date().toISOString(),
			agents: result.agents,
			files: result.copiedFiles,
			cloneUrl: deriveCloneUrlForManifest(parsed),
			...(constraint != null && { constraint }),
		};
		updatedManifest = addEntry(updatedManifest, manifestKey, entry);
	}
	await writeManifest(projectDir, updatedManifest);

	// 7. Per-plugin summary
	p.outro(
		renderCollectionAddSummary({
			manifestKey: parsed.manifestKey,
			ref: parsed.ref,
			commit,
			results,
		}),
	);
}

export const addCommand = new Command("add")
	.description("Install a plugin from a git repo or local path")
	.argument("<source>", "Git repo (owner/repo) or local path")
	.option("--plugin", "Bundle a skills-only source as a single plugin")
	.action(
		withExitSignal(async (source: string, options: { plugin?: boolean }) => {
			await runAdd(source, { forcePlugin: options.plugin === true });
		}),
	);
