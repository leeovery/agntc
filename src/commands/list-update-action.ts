import type { ManifestEntry, Manifest } from "../manifest.js";
import { writeManifest, addEntry } from "../manifest.js";
import { cloneAndReinstall, mapCloneFailure } from "../clone-reinstall.js";
import { validateLocalSourcePath } from "../fs-utils.js";
import { errorMessage } from "../errors.js";

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
  return runUpdate(key, entry, manifest, projectDir);
}

async function runUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<UpdateActionResult> {
  const isLocal = entry.commit === null;

  try {
    if (isLocal) {
      const pathResult = await validateLocalSourcePath(key);
      if (!pathResult.valid) {
        return {
          success: false,
          message: `Path ${key} does not exist or is not a directory`,
        };
      }
    }

    const result = await cloneAndReinstall({
      key,
      entry,
      projectDir,
      manifest,
      ...(isLocal ? { sourceDir: key } : {}),
    });

    if (result.status === "failed") {
      return mapCloneFailure(result, {
        onNoConfig: () => ({
          success: false,
          message: isLocal
            ? `${key} has no agntc.json`
            : `New version of ${key} has no agntc.json`,
        }),
        onNoAgents: () => ({
          success: false,
          message: `Plugin ${key} no longer supports any of your installed agents`,
        }),
        onInvalidType: () => ({
          success: false,
          message: isLocal
            ? `${key} is not a valid plugin`
            : `New version of ${key} is not a valid plugin`,
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
      message: isLocal ? `Refreshed ${key}` : `Updated ${key}`,
    };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}
