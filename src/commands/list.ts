import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifest, readManifestOrExit, type ManifestEntry, type Manifest } from "../manifest.js";
import { checkAllForUpdates } from "../update-check-all.js";
import { checkForUpdate, type UpdateCheckResult } from "../update-check.js";
import { withExitSignal } from "../exit-signal.js";
import { renderDetailView } from "./list-detail.js";
import { executeUpdateAction } from "./list-update-action.js";
import { executeRemoveAction } from "./list-remove-action.js";
import { executeChangeVersionAction } from "./list-change-version-action.js";

const DONE_VALUE = "__done__";

function formatLabel(key: string, entry: ManifestEntry): string {
  if (entry.ref !== null) {
    return `${key}@${entry.ref}`;
  }
  return key;
}

function formatStatusHint(result: UpdateCheckResult): string {
  switch (result.status) {
    case "up-to-date":
      return "\u2713 Up to date";
    case "update-available":
      return "\u2191 Update available";
    case "newer-tags":
      return "\u2691 Newer tags available";
    case "check-failed":
      return "\u2717 Check failed";
    case "local":
      return "\u25CF Local";
  }
}

async function showListView(
  manifest: Manifest,
  checkResults: Map<string, UpdateCheckResult>,
): Promise<string | null> {
  const entries = Object.entries(manifest);

  const options = entries.map(([key, entry]) => {
    const result = checkResults.get(key) ?? {
      status: "check-failed" as const,
      reason: "unknown",
    };
    return {
      value: key,
      label: formatLabel(key, entry),
      hint: formatStatusHint(result),
    };
  });

  options.push({
    value: DONE_VALUE,
    label: "Done",
    hint: "",
  });

  const selected = await p.select<string>({
    message: "Select a plugin to manage",
    options,
  });

  if (p.isCancel(selected) || selected === DONE_VALUE) {
    return null;
  }

  return selected;
}

export async function runListLoop(): Promise<void> {
  const projectDir = process.cwd();

  while (true) {
    const manifest = await readManifestOrExit(projectDir);

    const entries = Object.entries(manifest);

    if (entries.length === 0) {
      p.outro(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
      return;
    }

    const spin = p.spinner();
    spin.start("Checking for updates...");
    const checkResults = await checkAllForUpdates(manifest);
    spin.stop("Update checks complete.");

    const selectedKey = await showListView(manifest, checkResults);

    if (selectedKey === null) {
      return;
    }

    const entry = manifest[selectedKey];
    if (!entry) {
      continue;
    }

    while (true) {
      const freshManifest = await readManifest(projectDir);
      const freshEntry = freshManifest[selectedKey];
      if (!freshEntry) break;

      const freshStatus = await checkForUpdate(selectedKey, freshEntry);

      const action = await renderDetailView({
        key: selectedKey,
        entry: freshEntry,
        updateStatus: freshStatus,
      });

      if (action === "back") break;

      if (action === "remove") {
        const result = await executeRemoveAction(selectedKey, freshEntry, freshManifest, projectDir);
        if (result.removed) {
          p.log.success(result.message);
        }
        break;
      }

      if (action === "update") {
        const result = await executeUpdateAction(selectedKey, freshEntry, freshManifest, projectDir);
        if (result.success) {
          p.log.success(result.message);
        } else {
          p.log.error(result.message);
        }
        continue;
      }

      if (action === "change-version") {
        const result = await executeChangeVersionAction(selectedKey, freshEntry, freshManifest, projectDir, freshStatus);
        if (result.changed) {
          p.log.success(result.message);
        } else if (result.message !== "Cancelled") {
          p.log.error(result.message);
        }
        continue;
      }
    }
  }
}

export const listCommand = new Command("list")
  .description("List installed plugins")
  .action(withExitSignal(async () => {
    await runListLoop();
  }));
