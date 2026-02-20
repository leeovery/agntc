import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifestOrExit, writeManifest, addEntry, removeEntry } from "../manifest.js";
import type { ManifestEntry, Manifest } from "../manifest.js";
import { checkForUpdate } from "../update-check.js";
import type { UpdateCheckResult } from "../update-check.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import {
  renderGitUpdateSummary,
  renderLocalUpdateSummary,
  renderUpdateOutcomeSummary,
} from "../summary.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import { cloneAndReinstall, mapCloneFailure } from "../clone-reinstall.js";
import { validateLocalSourcePath } from "../fs-utils.js";
import { errorMessage } from "../errors.js";

type PluginOutcome =
  | { status: "updated"; key: string; summary: string; newEntry: ManifestEntry }
  | { status: "refreshed"; key: string; summary: string; newEntry: ManifestEntry }
  | { status: "up-to-date"; key: string; summary: string }
  | { status: "newer-tags"; key: string; summary: string }
  | { status: "check-failed"; key: string; summary: string }
  | { status: "failed"; key: string; summary: string }
  | { status: "copy-failed"; key: string; summary: string };

export async function runUpdate(key?: string): Promise<void> {
  if (key === undefined) {
    await runAllUpdates();
    return;
  }

  const projectDir = process.cwd();

  const manifest = await readManifestOrExit(projectDir);

  if (Object.keys(manifest).length === 0) {
    p.outro("No plugins installed.");
    return;
  }

  const targetKeys = resolveTargetKeys(key, manifest);

  let updatedManifest = { ...manifest };
  let hasChanges = false;

  for (const targetKey of targetKeys) {
    const entry = manifest[targetKey]!;
    const newEntry = await runSingleUpdate(targetKey, entry, manifest, projectDir);
    if (newEntry !== null) {
      updatedManifest = addEntry(updatedManifest, targetKey, newEntry);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    await writeManifest(projectDir, updatedManifest);
  }
}

async function runSingleUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<ManifestEntry | null> {
  // Check for update
  const result = await checkForUpdate(key, entry);

  if (result.status === "up-to-date") {
    p.outro(`${key} is already up to date.`);
    return null;
  }

  if (result.status === "check-failed") {
    p.log.error(`Update check failed for ${key}: ${result.reason}`);
    throw new ExitSignal(1);
  }

  if (result.status === "newer-tags") {
    p.log.info(`Pinned to ${entry.ref}. Newer tags available:`);
    const reversed = [...result.tags].reverse();
    for (const tag of reversed) {
      p.log.message(`  ${tag}`);
    }
    const newest = reversed[0]!;
    p.outro(`To upgrade: npx agntc add ${key}@${newest}`);
    return null;
  }

  // update-available or local — proceed with single plugin update
  return runSinglePluginUpdate(key, entry, manifest, projectDir);
}

async function validateLocalPath(sourcePath: string): Promise<void> {
  const result = await validateLocalSourcePath(sourcePath);
  if (!result.valid) {
    p.log.error(
      `Path ${sourcePath} does not exist or is not a directory.`,
    );
    throw new ExitSignal(1);
  }
}

async function runSinglePluginUpdate(
  key: string,
  entry: ManifestEntry,
  manifest: Manifest,
  projectDir: string,
): Promise<ManifestEntry | null> {
  const isLocal = entry.commit === null;

  if (isLocal) {
    await validateLocalPath(key);
  }

  const result = await cloneAndReinstall({
    key,
    entry,
    projectDir,
    manifest,
    ...(isLocal ? { sourceDir: key } : {}),
  });

  if (result.status === "failed") {
    const noConfigMsg = isLocal
      ? `${key} has no agntc.json — aborting.`
      : `New version of ${key} has no agntc.json — aborting.`;

    const invalidTypeMsg = isLocal
      ? `${key} is not a valid plugin — aborting.`
      : `New version of ${key} is not a valid plugin — aborting.`;

    return mapCloneFailure(result, {
      onNoConfig: () => {
        p.log.error(noConfigMsg);
        throw new ExitSignal(1);
      },
      onNoAgents: () => {
        p.log.warn(
          `Plugin ${key} no longer supports any of your installed agents. ` +
            `No update performed. Run npx agntc remove ${key} to clean up.`,
        );
        return null;
      },
      onInvalidType: () => {
        p.log.error(invalidTypeMsg);
        throw new ExitSignal(1);
      },
      onCopyFailed: (msg) => {
        p.log.error(msg);
        throw new ExitSignal(1);
      },
      onCloneFailed: (msg) => {
        if (!isLocal) p.cancel(msg);
        throw new ExitSignal(1);
      },
      onUnknown: (msg) => {
        if (!isLocal) p.cancel(msg);
        throw new ExitSignal(1);
      },
    });
  }

  if (isLocal) {
    p.outro(
      renderLocalUpdateSummary({
        key,
        copiedFiles: result.copiedFiles,
        effectiveAgents: result.manifestEntry.agents,
        droppedAgents: result.droppedAgents,
      }),
    );
  } else {
    p.outro(
      renderGitUpdateSummary({
        key,
        oldCommit: entry.commit,
        newCommit: result.manifestEntry.commit!,
        copiedFiles: result.copiedFiles,
        effectiveAgents: result.manifestEntry.agents,
        droppedAgents: result.droppedAgents,
      }),
    );
  }

  return result.manifestEntry;
}

// --- All-plugins mode helpers ---

interface CheckedPlugin {
  key: string;
  entry: ManifestEntry;
  checkResult: UpdateCheckResult;
}

async function processUpdateForAll(
  key: string,
  entry: ManifestEntry,
  projectDir: string,
): Promise<PluginOutcome> {
  try {
    const isLocal = entry.commit === null;

    // Local path validation
    if (isLocal) {
      const pathResult = await validateLocalSourcePath(key);
      if (!pathResult.valid) {
        return {
          status: "failed",
          key,
          summary: `${key}: Failed — ${pathResult.reason}`,
        };
      }
    }

    const result = await cloneAndReinstall({
      key,
      entry,
      projectDir,
      ...(isLocal ? { sourceDir: key } : {}),
    });

    if (result.status === "failed") {
      return mapCloneFailure(result, {
        onNoConfig: () => ({
          status: "failed" as const,
          key,
          summary: isLocal
            ? `${key}: Failed — no agntc.json`
            : `${key}: Failed — no agntc.json in new version`,
        }),
        onNoAgents: () => ({
          status: "failed" as const,
          key,
          summary: `${key}: Skipped — no longer supports installed agents`,
        }),
        onInvalidType: () => ({
          status: "failed" as const,
          key,
          summary: isLocal
            ? `${key}: Failed — not a valid plugin`
            : `${key}: Failed — not a valid plugin in new version`,
        }),
        onCopyFailed: (msg) => ({
          status: "copy-failed" as const,
          key,
          summary: msg,
        }),
        onCloneFailed: (msg) => ({
          status: "failed" as const,
          key,
          summary: `${key}: Failed — ${msg}`,
        }),
        onUnknown: (msg) => ({
          status: "failed" as const,
          key,
          summary: `${key}: Failed — ${msg}`,
        }),
      });
    }

    if (isLocal) {
      return {
        status: "refreshed",
        key,
        summary: renderUpdateOutcomeSummary({
          type: "local-update",
          key,
          droppedAgents: result.droppedAgents,
        }),
        newEntry: result.manifestEntry,
      };
    }

    return {
      status: "updated",
      key,
      summary: renderUpdateOutcomeSummary({
        type: "git-update",
        key,
        oldCommit: entry.commit,
        newCommit: result.manifestEntry.commit!,
        droppedAgents: result.droppedAgents,
      }),
      newEntry: result.manifestEntry,
    };
  } catch (err) {
    return {
      status: "failed",
      key,
      summary: `${key}: Failed — ${errorMessage(err)}`,
    };
  }
}

async function runAllUpdates(): Promise<void> {
  const projectDir = process.cwd();

  const manifest = await readManifestOrExit(projectDir);

  const entries = Object.entries(manifest);

  if (entries.length === 0) {
    p.outro("No plugins installed.");
    return;
  }

  // Parallel update checks with spinner
  const spin = p.spinner();
  spin.start("Checking for updates...");

  const checkResults: CheckedPlugin[] = await Promise.all(
    entries.map(async ([key, entry]) => ({
      key,
      entry,
      checkResult: await checkForUpdate(key, entry),
    })),
  );

  spin.stop("Update checks complete.");

  // Categorize
  const updateAvailable: CheckedPlugin[] = [];
  const local: CheckedPlugin[] = [];
  const newerTags: CheckedPlugin[] = [];
  const upToDate: CheckedPlugin[] = [];
  const checkFailed: CheckedPlugin[] = [];

  for (const checked of checkResults) {
    switch (checked.checkResult.status) {
      case "update-available":
        updateAvailable.push(checked);
        break;
      case "local":
        local.push(checked);
        break;
      case "newer-tags":
        newerTags.push(checked);
        break;
      case "up-to-date":
        upToDate.push(checked);
        break;
      case "check-failed":
        checkFailed.push(checked);
        break;
    }
  }

  // Process updatable plugins sequentially, collecting outcomes
  const outcomes: PluginOutcome[] = [];

  for (const checked of [...updateAvailable, ...local]) {
    const outcome = await processUpdateForAll(
      checked.key,
      checked.entry,
      projectDir,
    );
    outcomes.push(outcome);
  }

  // Build updated manifest with all successful updates and copy-failed removals
  let updatedManifest = { ...manifest };
  let hasChanges = false;

  for (const outcome of outcomes) {
    if (
      (outcome.status === "updated" || outcome.status === "refreshed") &&
      "newEntry" in outcome
    ) {
      updatedManifest = addEntry(updatedManifest, outcome.key, outcome.newEntry);
      hasChanges = true;
    } else if (outcome.status === "copy-failed") {
      updatedManifest = removeEntry(updatedManifest, outcome.key);
      hasChanges = true;
    }
  }

  // Single manifest write
  if (hasChanges) {
    await writeManifest(projectDir, updatedManifest);
  }

  // Collect summaries for non-actionable categories
  for (const checked of newerTags) {
    const result = checked.checkResult;
    if (result.status === "newer-tags") {
      const reversed = [...result.tags].reverse();
      const newest = reversed[0]!;
      outcomes.push({
        status: "newer-tags",
        key: checked.key,
        summary: `${checked.key}: Pinned to ${checked.entry.ref} — newer tags available (latest: ${newest})`,
      });
    }
  }

  for (const checked of upToDate) {
    outcomes.push({
      status: "up-to-date",
      key: checked.key,
      summary: `${checked.key}: Up to date`,
    });
  }

  for (const checked of checkFailed) {
    const result = checked.checkResult;
    const reason =
      result.status === "check-failed" ? result.reason : "unknown";
    outcomes.push({
      status: "check-failed",
      key: checked.key,
      summary: `${checked.key}: Check failed — ${reason}`,
    });
  }

  // If everything is up-to-date and nothing else happened
  const allUpToDate =
    updateAvailable.length === 0 &&
    local.length === 0 &&
    checkFailed.length === 0 &&
    newerTags.length === 0;

  if (allUpToDate) {
    p.outro("All plugins are up to date.");
    return;
  }

  // Per-plugin summary
  for (const outcome of outcomes) {
    if (outcome.status === "updated" || outcome.status === "refreshed") {
      p.log.success(outcome.summary);
    } else if (outcome.status === "copy-failed") {
      p.log.error(outcome.summary);
    } else if (outcome.status === "failed" || outcome.status === "check-failed") {
      p.log.warn(outcome.summary);
    } else if (outcome.status === "newer-tags") {
      p.log.info(outcome.summary);
    } else {
      p.log.message(outcome.summary);
    }
  }
}

export const updateCommand = new Command("update")
  .description("Update installed plugins")
  .argument(
    "[key]",
    "Plugin key to update (owner/repo or owner/repo/plugin)",
  )
  .action(withExitSignal(async (key?: string) => {
    await runUpdate(key);
  }));
