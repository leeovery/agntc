import * as p from "@clack/prompts";
import { join } from "node:path";
import type { ManifestEntry, Manifest } from "../manifest.js";
import type { UpdateCheckResult } from "../update-check.js";
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

export interface ChangeVersionResult {
  changed: boolean;
  newEntry?: ManifestEntry;
  message: string;
}

function buildParsedSource(key: string, ref: string): ParsedSource {
  const parts = key.split("/");
  return {
    type: "github-shorthand",
    owner: parts[0]!,
    repo: parts[1]!,
    ref,
    manifestKey: `${parts[0]}/${parts[1]}`,
  };
}

function getSourceDir(tempDir: string, key: string): string {
  const parts = key.split("/");
  if (parts.length > 2) {
    return join(tempDir, parts.slice(2).join("/"));
  }
  return tempDir;
}

export async function executeChangeVersionAction(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
  updateStatus: UpdateCheckResult,
): Promise<ChangeVersionResult> {
  if (updateStatus.status !== "newer-tags") {
    return { changed: false, message: "No tags available for version change" };
  }

  const tags = [...updateStatus.tags].reverse();

  const options = tags.map((tag) => ({
    value: tag,
    label: tag,
  }));

  const selected = await p.select({
    message: "Select a version",
    options,
  });

  if (p.isCancel(selected)) {
    return { changed: false, message: "Cancelled" };
  }

  const selectedTag = selected as string;

  if (selectedTag === entry.ref) {
    return { changed: false, message: "Already on this version" };
  }

  const parsed = buildParsedSource(key, selectedTag);
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
      return { changed: false, message };
    }
    spin.stop("Cloned successfully");

    tempDir = cloneResult.tempDir;
    const newCommit = cloneResult.commit;
    const sourceDir = getSourceDir(tempDir, key);

    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(sourceDir, { onWarn });

    if (config === null) {
      return {
        changed: false,
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
        changed: false,
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
        changed: false,
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
      ref: selectedTag,
      commit: newCommit,
      installedAt: new Date().toISOString(),
      agents: effectiveAgents,
      files: copiedFiles,
    };
    const updated = addEntry(manifest, key, newEntry);
    await writeManifest(projectDir, updated);

    return {
      changed: true,
      newEntry,
      message: `Changed ${key} to ${selectedTag}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { changed: false, message };
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
