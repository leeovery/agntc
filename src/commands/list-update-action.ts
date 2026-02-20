import * as p from "@clack/prompts";
import { stat } from "node:fs/promises";
import type { ManifestEntry, Manifest } from "../manifest.js";
import { writeManifest, addEntry, removeEntry } from "../manifest.js";
import { cloneAndReinstall, mapCloneFailure } from "../clone-reinstall.js";

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
  const result = await cloneAndReinstall({
    key,
    entry,
    projectDir,
  });

  if (result.status === "failed") {
    if (result.failureReason === "copy-failed") {
      await writeManifest(projectDir, removeEntry(manifest, key));
    }

    return mapCloneFailure(result, {
      onNoConfig: () => ({
        success: false,
        message: `New version of ${key} has no agntc.json`,
      }),
      onNoAgents: () => ({
        success: false,
        message: `Plugin ${key} no longer supports any of your installed agents`,
      }),
      onInvalidType: () => ({
        success: false,
        message: `New version of ${key} is not a valid plugin`,
      }),
      onCopyFailed: (msg) => ({
        success: false,
        message: msg,
      }),
      onCloneFailed: (msg) => ({
        success: false,
        message: msg,
      }),
      onUnknown: (msg) => ({
        success: false,
        message: msg,
      }),
    });
  }

  const updated = addEntry(manifest, key, result.manifestEntry);
  await writeManifest(projectDir, updated);

  return {
    success: true,
    newEntry: result.manifestEntry,
    message: `Updated ${key}`,
  };
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

    const result = await cloneAndReinstall({
      key,
      entry,
      projectDir,
      sourceDir: sourcePath,
    });

    if (result.status === "failed") {
      if (result.failureReason === "copy-failed") {
        await writeManifest(projectDir, removeEntry(manifest, key));
      }

      return mapCloneFailure(result, {
        onNoConfig: () => ({
          success: false,
          message: `${key} has no agntc.json`,
        }),
        onNoAgents: () => ({
          success: false,
          message: `Plugin ${key} no longer supports any of your installed agents`,
        }),
        onInvalidType: () => ({
          success: false,
          message: `${key} is not a valid plugin`,
        }),
        onCopyFailed: (msg) => ({
          success: false,
          message: msg,
        }),
        onCloneFailed: (msg) => ({
          success: false,
          message: msg,
        }),
        onUnknown: (msg) => ({
          success: false,
          message: msg,
        }),
      });
    }

    const updated = addEntry(manifest, key, result.manifestEntry);
    await writeManifest(projectDir, updated);

    return {
      success: true,
      newEntry: result.manifestEntry,
      message: `Refreshed ${key}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}
