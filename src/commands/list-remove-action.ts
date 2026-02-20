import * as p from "@clack/prompts";
import type { ManifestEntry, Manifest } from "../manifest.js";
import { writeManifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";

export interface RemoveActionResult {
  removed: boolean;
  message: string;
}

export async function executeRemoveAction(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<RemoveActionResult> {
  for (const file of entry.files) {
    p.log.message(`  ${file}`);
  }

  const confirmed = await p.confirm({
    message: `Remove ${key}? ${entry.files.length} file(s) will be deleted.`,
  });

  if (p.isCancel(confirmed) || confirmed !== true) {
    return { removed: false, message: "Cancelled" };
  }

  await nukeManifestFiles(projectDir, entry.files);

  const updated: Manifest = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (k !== key) {
      updated[k] = v;
    }
  }
  await writeManifest(projectDir, updated);

  return { removed: true, message: `Removed ${key}` };
}
