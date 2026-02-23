import { join } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { selectAgents } from "../agent-select.js";
import { selectCollectionPlugins } from "../collection-select.js";
import { checkFileCollisions } from "../collision-check.js";
import { resolveCollisions } from "../collision-resolve.js";
import { computeIncomingFiles } from "../compute-incoming-files.js";
import type { AgntcConfig } from "../config.js";
import { ConfigError, readConfig } from "../config.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import type { AssetCounts } from "../copy-plugin-assets.js";
import { copyPluginAssets } from "../copy-plugin-assets.js";
import { detectAgents } from "../detect-agents.js";
import { getDriver } from "../drivers/registry.js";
import type { AgentId } from "../drivers/types.js";
import { errorMessage } from "../errors.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { cleanupTempDir, cloneSource } from "../git-clone.js";
import type { Manifest } from "../manifest.js";
import { addEntry, readManifest, writeManifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { parseSource, resolveCloneUrl } from "../source-parser.js";
import { renderAddSummary, renderCollectionAddSummary } from "../summary.js";
import type { DetectedType } from "../type-detection.js";
import { detectType } from "../type-detection.js";
import { checkUnmanagedConflicts } from "../unmanaged-check.js";
import type { UnmanagedPluginConflicts } from "../unmanaged-resolve.js";
import { resolveUnmanagedConflicts } from "../unmanaged-resolve.js";

function deriveCloneUrlForManifest(
	parsed: Awaited<ReturnType<typeof parseSource>>,
): string | null {
	if (parsed.type === "local-path") return null;
	return resolveCloneUrl(parsed);
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

export async function runAdd(source: string): Promise<void> {
	p.intro("agntc add");

	let tempDir: string | undefined;

	try {
		// 1. Parse source
		const parsed = await parseSource(source);

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

		// 3. Read config
		const onWarn = (message: string) => p.log.warn(message);
		const config = await readConfig(sourceDir, { onWarn });

		// 4. Handle null config — detect if collection
		if (config === null) {
			const detected = await detectType(sourceDir, {
				hasConfig: false,
				onWarn,
			});

			if (detected.type === "collection") {
				await runCollectionPipeline({
					sourceDir,
					parsed,
					commit,
					detected,
					onWarn,
					spin,
				});
				return;
			}

			// Not a collection — not-agntc
			p.cancel(
				"Not an agntc source — no agntc.json found and no collection detected",
			);
			throw new ExitSignal(0);
		}

		// 5. Detect type (standalone)
		const detected = await detectType(sourceDir, {
			hasConfig: true,
			onWarn,
		});

		// 6. Handle unsupported types
		if (detected.type === "not-agntc") {
			throw new ExitSignal(0);
		}

		if (detected.type === "collection") {
			throw new ExitSignal(0);
		}

		// 7. Detect agents
		const projectDir = process.cwd();
		const detectedAgents = await detectAgents(projectDir);

		// 8. Select agents
		const selectedAgents = await selectAgents({
			declaredAgents: config.agents,
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

		// 10a. Compute incoming files
		const incomingFiles = await computeIncomingFiles(
			detected.type === "plugin"
				? { type: "plugin", sourceDir, assetDirs: detected.assetDirs, agents }
				: { type: "bare-skill", sourceDir, agents },
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
					sourceDir,
					assetDirs: detected.assetDirs,
					agents,
					projectDir,
				});
				copiedFiles = pluginResult.copiedFiles;
				assetCountsByAgent = pluginResult.assetCountsByAgent;
			} else {
				const bareResult = await copyBareSkill({
					sourceDir,
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
			cloneUrl: deriveCloneUrlForManifest(parsed),
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
}

interface PluginInstallResult {
	pluginName: string;
	status: "installed" | "skipped" | "failed";
	copiedFiles: string[];
	assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
	detectedType?: DetectedType;
	errorMessage?: string;
}

async function runCollectionPipeline(
	input: CollectionPipelineInput,
): Promise<void> {
	const { sourceDir, parsed, commit, detected, onWarn, spin } = input;
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

	// 3. Read configs for all selected plugins, collect union of declared agents
	const pluginConfigs = new Map<string, AgntcConfig>();
	const allDeclaredAgents = new Set<AgentId>();

	for (const pluginName of selectedPlugins) {
		const pluginDir = join(sourceDir, pluginName);
		try {
			const pluginConfig = await readConfig(pluginDir, { onWarn });
			if (pluginConfig === null) {
				onWarn(`${pluginName}: no agntc.json found — skipping`);
				continue;
			}
			pluginConfigs.set(pluginName, pluginConfig);
			for (const agent of pluginConfig.agents) {
				allDeclaredAgents.add(agent);
			}
		} catch (err) {
			if (err instanceof ConfigError) {
				onWarn(`${pluginName}: ${err.message} — skipping`);
				continue;
			}
			throw err;
		}
	}

	// If no valid plugins remain, exit gracefully
	if (pluginConfigs.size === 0) {
		p.log.warn("No valid plugins to install");
		throw new ExitSignal(0);
	}

	// 4. Detect agents + select once
	const detectedAgents = await detectAgents(projectDir);
	const selectedAgents = await selectAgents({
		declaredAgents: [...allDeclaredAgents],
		detectedAgents,
	});

	if (selectedAgents.length === 0) {
		p.cancel("Cancelled — no agents selected");
		throw new ExitSignal(0);
	}

	// 4a. Per-plugin agent compatibility warnings
	for (const [pluginName, pluginConfig] of pluginConfigs) {
		const declaredSet = new Set(pluginConfig.agents);
		for (const agent of selectedAgents) {
			if (!declaredSet.has(agent)) {
				p.log.warn(
					`Plugin ${pluginName} does not declare support for ${agent}. Installing at your own risk.`,
				);
			}
		}
	}

	const agents = selectedAgents.map((id) => ({
		id,
		driver: getDriver(id),
	}));

	// 5. Per-plugin conflict checks + install
	const results: PluginInstallResult[] = [];
	let currentManifest: Manifest = manifest;

	// 5a. Per-plugin conflict resolution (before any copying)
	const pluginsToInstall: Array<{
		pluginName: string;
		pluginDir: string;
		pluginDetected: Extract<DetectedType, { type: "bare-skill" | "plugin" }>;
		pluginManifestKey: string;
	}> = [];

	for (const pluginName of selectedPlugins) {
		const pluginConfig = pluginConfigs.get(pluginName);
		if (!pluginConfig) {
			results.push({ pluginName, status: "skipped", copiedFiles: [] });
			continue;
		}

		const pluginDir = join(sourceDir, pluginName);
		const pluginDetected = await detectType(pluginDir, {
			hasConfig: true,
			onWarn,
		});

		if (pluginDetected.type === "not-agntc") {
			onWarn(`${pluginName}: not a valid agntc plugin — skipping`);
			results.push({ pluginName, status: "skipped", copiedFiles: [] });
			continue;
		}

		if (pluginDetected.type === "collection") {
			onWarn(`${pluginName}: nested collections not supported — skipping`);
			results.push({ pluginName, status: "skipped", copiedFiles: [] });
			continue;
		}

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
				results.push({ pluginName, status: "skipped", copiedFiles: [] });
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
						agents,
					}
				: { type: "bare-skill", sourceDir: pluginDir, agents },
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
			results.push({ pluginName, status: "skipped", copiedFiles: [] });
			continue;
		}

		pluginsToInstall.push({
			pluginName,
			pluginDir,
			pluginDetected,
			pluginManifestKey,
		});
	}

	// 5b. Copy all approved plugins (independent failure handling)
	spin.start("Copying skill files...");
	for (const { pluginName, pluginDir, pluginDetected } of pluginsToInstall) {
		try {
			if (pluginDetected.type === "plugin") {
				const pluginResult = await copyPluginAssets({
					sourceDir: pluginDir,
					assetDirs: pluginDetected.assetDirs,
					agents,
					projectDir,
				});
				results.push({
					pluginName,
					status: "installed",
					copiedFiles: pluginResult.copiedFiles,
					assetCountsByAgent: pluginResult.assetCountsByAgent,
					detectedType: pluginDetected,
				});
			} else {
				// bare-skill
				const bareResult = await copyBareSkill({
					sourceDir: pluginDir,
					projectDir,
					agents,
				});
				results.push({
					pluginName,
					status: "installed",
					copiedFiles: bareResult.copiedFiles,
					detectedType: pluginDetected,
				});
			}
		} catch (err) {
			results.push({
				pluginName,
				status: "failed",
				copiedFiles: [],
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
			agents: selectedAgents,
			files: result.copiedFiles,
			cloneUrl: deriveCloneUrlForManifest(parsed),
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
			selectedAgents,
			results,
		}),
	);
}

export const addCommand = new Command("add")
	.description("Install a plugin from a git repo or local path")
	.argument("<source>", "Git repo (owner/repo) or local path")
	.action(
		withExitSignal(async (source: string) => {
			await runAdd(source);
		}),
	);
