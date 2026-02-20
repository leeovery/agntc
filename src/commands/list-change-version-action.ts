import * as p from "@clack/prompts";
import type { ManifestEntry, Manifest } from "../manifest.js";
import type { UpdateCheckResult } from "../update-check.js";
import { writeManifest, addEntry, removeEntry } from "../manifest.js";
import { cloneAndReinstall } from "../clone-reinstall.js";

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

  const result = await cloneAndReinstall({
    key,
    entry,
    projectDir,
    newRef: selectedTag,
  });

  if (result.status === "failed") {
    if (result.failureReason === "no-config") {
      return {
        changed: false,
        message: `New version of ${key} has no agntc.json`,
      };
    }

    if (result.failureReason === "no-agents") {
      return {
        changed: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      };
    }

    if (result.failureReason === "invalid-type") {
      return {
        changed: false,
        message: `New version of ${key} is not a valid plugin`,
      };
    }

    if (result.failureReason === "copy-failed") {
      await writeManifest(projectDir, removeEntry(manifest, key));
      return {
        changed: false,
        message: result.message,
      };
    }

    // clone-failed or unknown
    return { changed: false, message: result.message };
  }

  const updated = addEntry(manifest, key, result.manifestEntry);
  await writeManifest(projectDir, updated);

  return {
    changed: true,
    newEntry: result.manifestEntry,
    message: `Changed ${key} to ${selectedTag}`,
  };
}
