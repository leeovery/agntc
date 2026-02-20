import { Command } from "commander";
import * as p from "@clack/prompts";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { readManifest, writeManifest, addEntry } from "../manifest.js";
import type { ManifestEntry } from "../manifest.js";
import { checkForUpdate } from "../update-check.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import type { ParsedSource } from "../source-parser.js";
import { readConfig } from "../config.js";
import { detectType } from "../type-detection.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { copyPluginAssets } from "../copy-plugin-assets.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import { getDriver } from "../drivers/registry.js";
import type { AgentId } from "../drivers/types.js";
import { ExitSignal } from "../exit-signal.js";

function buildParsedSource(
  key: string,
  entry: ManifestEntry,
): ParsedSource {
  const parts = key.split("/");
  const owner = parts[0]!;
  const repo = parts[1]!;

  return {
    type: "github-shorthand",
    owner,
    repo,
    ref: entry.ref,
    manifestKey: `${owner}/${repo}`,
  };
}

function getSourceDir(tempDir: string, key: string): string {
  const parts = key.split("/");
  if (parts.length > 2) {
    const subPath = parts.slice(2).join("/");
    return join(tempDir, subPath);
  }
  return tempDir;
}

function computeEffectiveAgents(
  entryAgents: string[],
  newConfigAgents: string[],
): string[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => newSet.has(a));
}

function findDroppedAgents(
  entryAgents: string[],
  newConfigAgents: string[],
): string[] {
  const newSet = new Set(newConfigAgents);
  return entryAgents.filter((a) => !newSet.has(a));
}

export async function runUpdate(key?: string): Promise<void> {
  if (key === undefined) {
    p.log.error(
      "Please specify a plugin to update: npx agntc update owner/repo",
    );
    throw new ExitSignal(1);
  }

  const projectDir = process.cwd();

  const manifest = await readManifest(projectDir).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(`Failed to read manifest: ${message}`);
    throw new ExitSignal(1);
  });

  const entries = Object.entries(manifest);

  if (entries.length === 0) {
    p.outro("No plugins installed.");
    return;
  }

  const entry = manifest[key];
  if (!entry) {
    p.log.error(`Plugin ${key} is not installed.`);
    throw new ExitSignal(1);
  }

  // Check for update
  const result = await checkForUpdate(key, entry);

  if (result.status === "up-to-date") {
    p.outro(`${key} is already up to date.`);
    return;
  }

  if (result.status === "check-failed") {
    p.log.error(`Update check failed for ${key}: ${result.reason}`);
    throw new ExitSignal(1);
  }

  if (result.status === "newer-tags") {
    p.outro(`${key} is already up to date (tag-pinned).`);
    return;
  }

  if (result.status === "local") {
    await runLocalUpdate(key, entry, manifest, projectDir);
    return;
  }

  // update-available — proceed with clone-then-nuke pipeline
  const parsed = buildParsedSource(key, entry);
  let tempDir: string | undefined;

  try {
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
    const newCommit = cloneResult.commit;
    const sourceDir = getSourceDir(tempDir, key);

    // Read config from new version
    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(sourceDir, { onWarn });

    if (config === null) {
      p.log.error(`New version of ${key} has no agntc.json — aborting.`);
      throw new ExitSignal(1);
    }

    // Agent compatibility check
    const effectiveAgents = computeEffectiveAgents(
      entry.agents,
      config.agents,
    );
    const droppedAgents = findDroppedAgents(entry.agents, config.agents);

    if (effectiveAgents.length === 0) {
      p.log.warn(
        `Plugin ${key} no longer supports any of your installed agents. ` +
          `No update performed. Run npx agntc remove ${key} to clean up.`,
      );
      return;
    }

    if (droppedAgents.length > 0) {
      p.log.warn(
        `Plugin ${key} no longer declares support for ${droppedAgents.join(", ")}. ` +
          `Currently installed for: ${entry.agents.join(", ")}. ` +
          `New version supports: ${config.agents.join(", ")}.`,
      );
    }

    // Detect type from new version
    const detected = await detectType(sourceDir, {
      hasConfig: true,
      onWarn,
    });

    if (detected.type === "not-agntc" || detected.type === "collection") {
      p.log.error(`New version of ${key} is not a valid plugin — aborting.`);
      throw new ExitSignal(1);
    }

    // Build agent+driver pairs for effective agents
    const agents = effectiveAgents.map((id) => ({
      id: id as AgentId,
      driver: getDriver(id as AgentId),
    }));

    // Nuke existing files (after clone succeeded)
    await nukeManifestFiles(projectDir, entry.files);

    // Copy from temp
    let copiedFiles: string[];

    spin.start("Copying files...");
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

    // Update manifest
    const newEntry: ManifestEntry = {
      ref: entry.ref,
      commit: newCommit,
      installedAt: new Date().toISOString(),
      agents: effectiveAgents,
      files: copiedFiles,
    };
    const updated = addEntry(manifest, key, newEntry);
    await writeManifest(projectDir, updated);

    // Summary
    const oldShort = entry.commit ? entry.commit.slice(0, 7) : "unknown";
    const newShort = newCommit.slice(0, 7);
    p.outro(
      `Updated ${key}: ${oldShort} -> ${newShort} — ${copiedFiles.length} file(s) for ${effectiveAgents.join(", ")}`,
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

async function validateLocalPath(sourcePath: string): Promise<void> {
  try {
    const stats = await stat(sourcePath);
    if (!stats.isDirectory()) {
      p.log.error(
        `Path ${sourcePath} does not exist or is not a directory.`,
      );
      throw new ExitSignal(1);
    }
  } catch (err) {
    if (err instanceof ExitSignal) throw err;
    p.log.error(
      `Path ${sourcePath} does not exist or is not a directory.`,
    );
    throw new ExitSignal(1);
  }
}

async function runLocalUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Record<string, ManifestEntry>,
  projectDir: string,
): Promise<void> {
  const sourcePath = key;

  await validateLocalPath(sourcePath);

  const onWarn = (message: string) => p.log.warn(message);
  const config = await readConfig(sourcePath, { onWarn });

  if (config === null) {
    p.log.error(`${key} has no agntc.json — aborting.`);
    throw new ExitSignal(1);
  }

  const effectiveAgents = computeEffectiveAgents(
    entry.agents,
    config.agents,
  );
  const droppedAgents = findDroppedAgents(entry.agents, config.agents);

  if (effectiveAgents.length === 0) {
    p.log.warn(
      `Plugin ${key} no longer supports any of your installed agents. ` +
        `No update performed. Run npx agntc remove ${key} to clean up.`,
    );
    return;
  }

  if (droppedAgents.length > 0) {
    p.log.warn(
      `Plugin ${key} no longer declares support for ${droppedAgents.join(", ")}. ` +
        `Currently installed for: ${entry.agents.join(", ")}. ` +
        `New version supports: ${config.agents.join(", ")}.`,
    );
  }

  const detected = await detectType(sourcePath, {
    hasConfig: true,
    onWarn,
  });

  if (detected.type === "not-agntc" || detected.type === "collection") {
    p.log.error(`${key} is not a valid plugin — aborting.`);
    throw new ExitSignal(1);
  }

  const agents = effectiveAgents.map((id) => ({
    id: id as AgentId,
    driver: getDriver(id as AgentId),
  }));

  await nukeManifestFiles(projectDir, entry.files);

  let copiedFiles: string[];

  if (detected.type === "plugin") {
    const pluginResult = await copyPluginAssets({
      sourceDir: sourcePath,
      assetDirs: detected.assetDirs,
      agents,
      projectDir,
    });
    copiedFiles = pluginResult.copiedFiles;
  } else {
    const bareResult = await copyBareSkill({
      sourceDir: sourcePath,
      projectDir,
      agents,
    });
    copiedFiles = bareResult.copiedFiles;
  }

  const newEntry: ManifestEntry = {
    ref: null,
    commit: null,
    installedAt: new Date().toISOString(),
    agents: effectiveAgents,
    files: copiedFiles,
  };
  const updated = addEntry(manifest, key, newEntry);
  await writeManifest(projectDir, updated);

  p.outro(
    `Refreshed ${key} — ${copiedFiles.length} file(s) for ${effectiveAgents.join(", ")}`,
  );
}

export const updateCommand = new Command("update")
  .description("Update installed plugins")
  .argument(
    "[key]",
    "Plugin key to update (owner/repo or owner/repo/plugin)",
  )
  .action(async (key?: string) => {
    try {
      await runUpdate(key);
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
