import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifest, writeManifest, type Manifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { ExitSignal } from "../exit-signal.js";

async function selectPluginsInteractive(
  manifest: Manifest,
): Promise<string[]> {
  const entries = Object.entries(manifest);

  const options = entries.map(([key, entry]) => ({
    value: key,
    label: key,
    hint: entry.ref ?? "HEAD",
  }));

  const result = await p.multiselect<string>({
    message: "Select plugins to remove",
    options,
    required: false,
  });

  if (p.isCancel(result)) {
    return [];
  }

  return result;
}

function resolveTargetKeys(
  key: string,
  manifest: Manifest,
): string[] {
  const entries = Object.entries(manifest);

  const exactMatch = manifest[key];
  if (exactMatch) {
    return [key];
  }

  const prefix = `${key}/`;
  const prefixKeys = entries
    .filter(([k]) => k.startsWith(prefix))
    .map(([k]) => k);

  if (prefixKeys.length === 0) {
    p.log.error(`Plugin ${key} is not installed.`);
    throw new ExitSignal(1);
  }

  return prefixKeys;
}

export async function runRemove(key?: string): Promise<void> {
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

  let targetKeys: string[];
  let summaryLabel: string;

  if (key !== undefined) {
    targetKeys = resolveTargetKeys(key, manifest);
    summaryLabel = targetKeys.length === 1 ? targetKeys[0]! : key;
  } else {
    const selected = await selectPluginsInteractive(manifest);
    if (selected.length === 0) {
      p.cancel("Cancelled");
      throw new ExitSignal(0);
    }
    targetKeys = selected;
    summaryLabel =
      targetKeys.length === 1
        ? targetKeys[0]!
        : `${targetKeys.length} plugin(s)`;
  }

  // Gather all files across target plugins
  const allFiles = targetKeys.flatMap((k) => manifest[k]?.files ?? []);

  // Show files that will be deleted
  p.intro("agntc remove");
  for (const file of allFiles) {
    p.log.message(file);
  }

  // Confirm
  const confirmed = await p.confirm({
    message: `Remove ${summaryLabel}? ${allFiles.length} file(s) will be deleted.`,
  });

  if (p.isCancel(confirmed) || confirmed !== true) {
    p.cancel("Cancelled");
    throw new ExitSignal(0);
  }

  // Nuke files per target plugin
  for (const k of targetKeys) {
    const entry = manifest[k];
    if (entry) {
      await nukeManifestFiles(projectDir, entry.files);
    }
  }

  // Remove entries from manifest and write
  const updated: Manifest = {};
  for (const [k, v] of entries) {
    if (!targetKeys.includes(k)) {
      updated[k] = v;
    }
  }
  await writeManifest(projectDir, updated);

  // Summary
  p.outro(`Removed ${summaryLabel} — ${allFiles.length} file(s)`);
}

export const removeCommand = new Command("remove")
  .description("Remove installed plugins")
  .argument("[key]", "Plugin key to remove (owner/repo or owner/repo/plugin)")
  .action(async (key?: string) => {
    try {
      await runRemove(key);
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
