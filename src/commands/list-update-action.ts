import * as p from "@clack/prompts";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import type { ManifestEntry, Manifest } from "../manifest.js";
import type { ParsedSource } from "../source-parser.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import { readConfig } from "../config.js";
import { detectType } from "../type-detection.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { copyPluginAssets } from "../copy-plugin-assets.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import { getDriver } from "../drivers/registry.js";
import type { AgentId } from "../drivers/types.js";
import { computeEffectiveAgents, findDroppedAgents } from "../agent-compat.js";
import { writeManifest, addEntry } from "../manifest.js";

export interface UpdateActionResult {
  success: boolean;
  newEntry?: ManifestEntry;
  message: string;
}

export async function executeUpdateAction(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<UpdateActionResult> {
  if (entry.commit !== null) {
    return runRemoteUpdate(key, entry, manifest, projectDir);
  }
  return runLocalUpdate(key, entry, manifest, projectDir);
}

function buildParsedSource(key: string, entry: ManifestEntry): ParsedSource {
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

async function runRemoteUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<UpdateActionResult> {
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
    spin.stop("Cloned successfully");

    tempDir = cloneResult.tempDir;
    const newCommit = cloneResult.commit;
    const sourceDir = getSourceDir(tempDir, key);

    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(sourceDir, { onWarn });

    if (config === null) {
      return {
        success: false,
        message: `New version of ${key} has no agntc.json`,
      };
    }

    const effectiveAgents = computeEffectiveAgents(
      entry.agents,
      config.agents,
    );
    const droppedAgents = findDroppedAgents(entry.agents, config.agents);

    if (effectiveAgents.length === 0) {
      return {
        success: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
    }

    if (droppedAgents.length > 0) {
      p.log.warn(
        `Plugin ${key} no longer declares support for ${droppedAgents.join(", ")}. ` +
          `Currently installed for: ${entry.agents.join(", ")}. ` +
          `New version supports: ${config.agents.join(", ")}.`,
      );
    }

    const detected = await detectType(sourceDir, {
      hasConfig: true,
      onWarn,
    });

    if (detected.type === "not-agntc" || detected.type === "collection") {
      return {
        success: false,
        message: `New version of ${key} is not a valid plugin`,
      };
    }

    const agents = effectiveAgents.map((id) => ({
      id: id as AgentId,
      driver: getDriver(id as AgentId),
    }));

    await nukeManifestFiles(projectDir, entry.files);

    let copiedFiles: string[];

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

    const newEntry: ManifestEntry = {
      ref: entry.ref,
      commit: newCommit,
      installedAt: new Date().toISOString(),
      agents: effectiveAgents,
      files: copiedFiles,
    };
    const updated = addEntry(manifest, key, newEntry);
    await writeManifest(projectDir, updated);

    return {
      success: true,
      newEntry,
      message: `Updated ${key}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
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

async function runLocalUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<UpdateActionResult> {
  try {
    const sourcePath = key;

    try {
      const stats = await stat(sourcePath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          message: `Path ${sourcePath} does not exist or is not a directory`,
        };
      }
    } catch {
      return {
        success: false,
        message: `Path ${sourcePath} does not exist or is not a directory`,
      };
    }

    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(sourcePath, { onWarn });

    if (config === null) {
      return {
        success: false,
        message: `${key} has no agntc.json`,
      };
    }

    const effectiveAgents = computeEffectiveAgents(
      entry.agents,
      config.agents,
    );
    const droppedAgents = findDroppedAgents(entry.agents, config.agents);

    if (effectiveAgents.length === 0) {
      return {
        success: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
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
      return {
        success: false,
        message: `${key} is not a valid plugin`,
      };
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

    return {
      success: true,
      newEntry,
      message: `Refreshed ${key}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}
