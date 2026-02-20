import { Command } from "commander";
import * as p from "@clack/prompts";
import { join } from "node:path";
import { parseSource } from "../source-parser.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import { readConfig, ConfigError } from "../config.js";
import { detectType } from "../type-detection.js";
import type { DetectedType } from "../type-detection.js";
import { getDriver } from "../drivers/registry.js";
import { detectAgents } from "../detect-agents.js";
import { selectAgents } from "../agent-select.js";
import { selectCollectionPlugins } from "../collection-select.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import { copyPluginAssets } from "../copy-plugin-assets.js";
import type { AssetCounts } from "../copy-plugin-assets.js";
import type { Manifest } from "../manifest.js";
import { readManifest, writeManifest, addEntry } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { ExitSignal } from "../exit-signal.js";
import type { AgentId } from "../drivers/types.js";
import type { AgntcConfig } from "../config.js";

export async function runAdd(source: string): Promise<void> {
  p.intro("agntc add");

  let tempDir: string | undefined;

  try {
    // 1. Parse source
    const parsed = await parseSource(source);

    // 2. Clone source (with spinner)
    const spin = p.spinner();
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

    // 3. Read config
    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(tempDir, { onWarn });

    // 4. Handle null config — detect if collection
    if (config === null) {
      const detected = await detectType(tempDir, {
        hasConfig: false,
        onWarn,
      });

      if (detected.type === "collection") {
        await runCollectionPipeline({
          tempDir,
          parsed,
          cloneResult,
          detected,
          onWarn,
          spin,
        });
        return;
      }

      // Not a collection — not-agntc
      throw new ExitSignal(0);
    }

    // 5. Detect type (standalone)
    const detected = await detectType(tempDir, {
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
      declaredAgents: config.agents as AgentId[],
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

    // 11. Copy assets (with spinner)
    let copiedFiles: string[];
    let assetCountsByAgent: Record<string, AssetCounts> | undefined;

    spin.start("Copying skill files...");
    try {
      if (detected.type === "plugin") {
        const pluginResult = await copyPluginAssets({
          sourceDir: tempDir,
          assetDirs: detected.assetDirs,
          agents,
          projectDir,
        });
        copiedFiles = pluginResult.copiedFiles;
        assetCountsByAgent = pluginResult.assetCountsByAgent;
      } else {
        const bareResult = await copyBareSkill({
          sourceDir: tempDir,
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
      commit: cloneResult.commit,
      installedAt: new Date().toISOString(),
      agents: selectedAgents as string[],
      files: copiedFiles,
    };
    const updated = addEntry(manifest, parsed.manifestKey, entry);
    await writeManifest(projectDir, updated);

    // 14. Summary
    const refLabel = parsed.ref ?? "HEAD";
    const agentSummary =
      detected.type === "plugin" && assetCountsByAgent
        ? formatPluginSummary(selectedAgents, assetCountsByAgent)
        : formatBareSkillSummary(selectedAgents, copiedFiles);

    p.outro(
      `Installed ${parsed.manifestKey}@${refLabel} — ${agentSummary}`,
    );
  } catch (err) {
    if (err instanceof ExitSignal) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    p.cancel(message);
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
  tempDir: string;
  parsed: Awaited<ReturnType<typeof parseSource>>;
  cloneResult: { commit: string };
  detected: Extract<DetectedType, { type: "collection" }>;
  onWarn: (message: string) => void;
  spin: ReturnType<typeof p.spinner>;
}

interface PluginInstallResult {
  pluginName: string;
  status: "installed" | "skipped";
  copiedFiles: string[];
  assetCountsByAgent?: Record<string, AssetCounts>;
  detectedType?: DetectedType;
}

async function runCollectionPipeline(
  input: CollectionPipelineInput,
): Promise<void> {
  const { tempDir, parsed, cloneResult, detected, onWarn, spin } = input;
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
  const allDeclaredAgents = new Set<string>();

  for (const pluginName of selectedPlugins) {
    const pluginDir = join(tempDir, pluginName);
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
    declaredAgents: [...allDeclaredAgents] as AgentId[],
    detectedAgents,
  });

  if (selectedAgents.length === 0) {
    p.cancel("Cancelled — no agents selected");
    throw new ExitSignal(0);
  }

  const agents = selectedAgents.map((id) => ({
    id,
    driver: getDriver(id),
  }));

  // 5. Per-plugin install
  const results: PluginInstallResult[] = [];

  spin.start("Copying skill files...");
  try {
    for (const pluginName of selectedPlugins) {
      const pluginConfig = pluginConfigs.get(pluginName);
      if (!pluginConfig) {
        results.push({ pluginName, status: "skipped", copiedFiles: [] });
        continue;
      }

      const pluginDir = join(tempDir, pluginName);
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
      const existingPluginEntry = manifest[pluginManifestKey];
      if (existingPluginEntry) {
        try {
          await nukeManifestFiles(projectDir, existingPluginEntry.files);
        } catch {
          onWarn(`${pluginName}: failed to remove old files — skipping`);
          results.push({ pluginName, status: "skipped", copiedFiles: [] });
          continue;
        }
      }

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
    }
  } catch (err) {
    spin.stop("Copy failed");
    throw err;
  }
  spin.stop("Copied successfully");

  // 6. Single manifest write
  let updatedManifest: Manifest = manifest;
  for (const result of results) {
    if (result.status !== "installed") continue;
    const manifestKey =
      parsed.type === "direct-path"
        ? parsed.manifestKey
        : `${parsed.manifestKey}/${result.pluginName}`;
    const entry = {
      ref: parsed.ref,
      commit: cloneResult.commit,
      installedAt: new Date().toISOString(),
      agents: selectedAgents as string[],
      files: result.copiedFiles,
    };
    updatedManifest = addEntry(updatedManifest, manifestKey, entry);
  }
  await writeManifest(projectDir, updatedManifest);

  // 7. Per-plugin summary
  const refLabel = parsed.ref ?? "HEAD";
  const installed = results.filter((r) => r.status === "installed");
  const skipped = results.filter((r) => r.status === "skipped");

  const pluginSummaries = installed.map((r) => {
    if (r.detectedType?.type === "plugin" && r.assetCountsByAgent) {
      return `${r.pluginName}: ${formatPluginSummary(selectedAgents, r.assetCountsByAgent)}`;
    }
    return `${r.pluginName}: ${formatBareSkillSummary(selectedAgents, r.copiedFiles)}`;
  });

  const summaryParts = [...pluginSummaries];
  if (skipped.length > 0) {
    summaryParts.push(`${skipped.length} skipped`);
  }

  p.outro(
    `Installed ${parsed.manifestKey}@${refLabel} — ${summaryParts.join(", ")}`,
  );
}

function formatBareSkillSummary(
  agentIds: AgentId[],
  copiedFiles: string[],
): string {
  return agentIds
    .map((id) => {
      const driver = getDriver(id);
      const targetPrefix = driver.getTargetDir("skills");
      const count = copiedFiles.filter(
        (f) => targetPrefix !== null && f.startsWith(targetPrefix),
      ).length;
      return `${id}: ${count} skill(s)`;
    })
    .join(", ");
}

function formatPluginSummary(
  agentIds: AgentId[],
  assetCountsByAgent: Record<string, AssetCounts>,
): string {
  const parts: string[] = [];

  for (const id of agentIds) {
    const counts = assetCountsByAgent[id];
    if (!counts) continue;

    const nonZero = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${count} ${type.replace(/s$/, "")}(s)`)
      .join(", ");

    if (nonZero.length > 0) {
      parts.push(`${id}: ${nonZero}`);
    }
  }

  return parts.join(", ");
}

export const addCommand = new Command("add")
  .description("Install a plugin from a git repo or local path")
  .argument("<source>", "Git repo (owner/repo) or local path")
  .action(async (source: string) => {
    try {
      await runAdd(source);
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
