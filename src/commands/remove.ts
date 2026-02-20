import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifestOrExit, writeManifest, type Manifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { ExitSignal } from "../exit-signal.js";
import { renderRemoveSummary } from "../summary.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";

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

interface FileGroup {
  header: string;
  files: string[];
}

function classifyFile(file: string): string {
  if (file.includes("/skills/")) return "Skills";
  if (file.includes("/agents/")) return "Agents";
  if (file.includes("/hooks/")) return "Hooks";
  return "Other";
}

function groupFilesByType(files: string[]): FileGroup[] {
  const order = ["Skills", "Agents", "Hooks", "Other"];
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const type = classifyFile(file);
    const existing = groups.get(type);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(type, [file]);
    }
  }

  const result: FileGroup[] = [];
  for (const type of order) {
    const typeFiles = groups.get(type);
    if (typeFiles && typeFiles.length > 0) {
      result.push({ header: type, files: typeFiles });
    }
  }
  return result;
}

export async function runRemove(key?: string): Promise<void> {
  const projectDir = process.cwd();

  const manifest = await readManifestOrExit(projectDir);

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

  // List affected plugins for collection prefix matches
  if (key !== undefined && targetKeys.length > 1) {
    for (const k of targetKeys) {
      p.log.info(k);
    }
  }

  // Group files by type
  const grouped = groupFilesByType(allFiles);
  for (const group of grouped) {
    p.log.message(group.header);
    for (const file of group.files) {
      p.log.message(`  ${file}`);
    }
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
  p.outro(
    renderRemoveSummary({
      summaryLabel,
      fileCount: allFiles.length,
    }),
  );
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
