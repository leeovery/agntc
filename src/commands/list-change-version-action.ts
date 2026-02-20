import * as p from "@clack/prompts";
import type { ManifestEntry, Manifest } from "../manifest.js";
import type { UpdateCheckResult } from "../update-check.js";
import { buildParsedSourceFromKey, getSourceDirFromKey } from "../source-parser.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import { writeManifest, addEntry, removeEntry } from "../manifest.js";
import {
  executeNukeAndReinstall,
} from "../nuke-reinstall-pipeline.js";

export interface ChangeVersionResult {
  changed: boolean;
  newEntry?: ManifestEntry;
  message: string;
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

  const parsed = buildParsedSourceFromKey(key, selectedTag, entry.cloneUrl);
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
    const sourceDir = getSourceDirFromKey(tempDir, key);

    const onWarn = (message: string) => p.log.warn(message);

    const pipelineResult = await executeNukeAndReinstall({
      key,
      sourceDir,
      existingEntry: entry,
      projectDir,
      newRef: selectedTag,
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
        changed: false,
        message: `New version of ${key} has no agntc.json`,
      };
    }

    if (pipelineResult.status === "no-agents") {
      return {
        changed: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
    }

    if (pipelineResult.status === "invalid-type") {
      return {
        changed: false,
        message: `New version of ${key} is not a valid plugin`,
      };
    }

    if (pipelineResult.status === "copy-failed") {
      await writeManifest(projectDir, removeEntry(manifest, key));
      return {
        changed: false,
        message: pipelineResult.recoveryHint,
      };
    }

    const updated = addEntry(manifest, key, pipelineResult.entry);
    await writeManifest(projectDir, updated);

    return {
      changed: true,
      newEntry: pipelineResult.entry,
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
