import * as p from "@clack/prompts";
import { stat } from "node:fs/promises";
import type { ManifestEntry, Manifest } from "../manifest.js";
import { buildParsedSourceFromKey, getSourceDirFromKey } from "../source-parser.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import { writeManifest, addEntry, removeEntry } from "../manifest.js";
import {
  executeNukeAndReinstall,
} from "../nuke-reinstall-pipeline.js";

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

async function runRemoteUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<UpdateActionResult> {
  const parsed = buildParsedSourceFromKey(key, entry.ref, entry.cloneUrl);
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
    const sourceDir = getSourceDirFromKey(tempDir, key);

    const onWarn = (message: string) => p.log.warn(message);

    const pipelineResult = await executeNukeAndReinstall({
      key,
      sourceDir,
      existingEntry: entry,
      projectDir,
      newCommit,
      onAgentsDropped: (dropped, newConfigAgents) => {
        p.log.warn(
          `Plugin ${key} no longer declares support for ${dropped.join(", ")}. ` +
            `Currently installed for: ${entry.agents.join(", ")}. ` +
            `New version supports: ${newConfigAgents.join(", ")}.`,
        );
      },
      onWarn,
    });

    if (pipelineResult.status === "no-config") {
      return {
        success: false,
        message: `New version of ${key} has no agntc.json`,
      };
    }

    if (pipelineResult.status === "no-agents") {
      return {
        success: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
    }

    if (pipelineResult.status === "invalid-type") {
      return {
        success: false,
        message: `New version of ${key} is not a valid plugin`,
      };
    }

    if (pipelineResult.status === "copy-failed") {
      await writeManifest(projectDir, removeEntry(manifest, key));
      return {
        success: false,
        message: pipelineResult.recoveryHint,
      };
    }

    const updated = addEntry(manifest, key, pipelineResult.entry);
    await writeManifest(projectDir, updated);

    return {
      success: true,
      newEntry: pipelineResult.entry,
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

    const pipelineResult = await executeNukeAndReinstall({
      key,
      sourceDir: sourcePath,
      existingEntry: entry,
      projectDir,
      newRef: null,
      newCommit: null,
      onAgentsDropped: (dropped, newConfigAgents) => {
        p.log.warn(
          `Plugin ${key} no longer declares support for ${dropped.join(", ")}. ` +
            `Currently installed for: ${entry.agents.join(", ")}. ` +
            `New version supports: ${newConfigAgents.join(", ")}.`,
        );
      },
      onWarn,
    });

    if (pipelineResult.status === "no-config") {
      return {
        success: false,
        message: `${key} has no agntc.json`,
      };
    }

    if (pipelineResult.status === "no-agents") {
      return {
        success: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
    }

    if (pipelineResult.status === "invalid-type") {
      return {
        success: false,
        message: `${key} is not a valid plugin`,
      };
    }

    if (pipelineResult.status === "copy-failed") {
      await writeManifest(projectDir, removeEntry(manifest, key));
      return {
        success: false,
        message: pipelineResult.recoveryHint,
      };
    }

    const updated = addEntry(manifest, key, pipelineResult.entry);
    await writeManifest(projectDir, updated);

    return {
      success: true,
      newEntry: pipelineResult.entry,
      message: `Refreshed ${key}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}
