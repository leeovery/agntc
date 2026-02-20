import { Command } from "commander";
import * as p from "@clack/prompts";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { readManifest, writeManifest, addEntry } from "../manifest.js";
import type { ManifestEntry, Manifest } from "../manifest.js";
import { checkForUpdate } from "../update-check.js";
import type { UpdateCheckResult } from "../update-check.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import type { ParsedSource } from "../source-parser.js";
import { ExitSignal } from "../exit-signal.js";
import {
  executeNukeAndReinstall,
} from "../nuke-reinstall-pipeline.js";
import {
  renderGitUpdateSummary,
  renderLocalUpdateSummary,
  renderUpdateOutcomeSummary,
} from "../summary.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";

type PluginOutcome =
  | { status: "updated"; key: string; summary: string; newEntry: ManifestEntry }
  | { status: "refreshed"; key: string; summary: string; newEntry: ManifestEntry }
  | { status: "up-to-date"; key: string; summary: string }
  | { status: "newer-tags"; key: string; summary: string }
  | { status: "check-failed"; key: string; summary: string }
  | { status: "failed"; key: string; summary: string };

function buildParsedSource(
  key: string,
  entry: ManifestEntry,
): ParsedSource {
  const parts = key.split("/");
  const owner = parts[0]!;
  const repo = parts[1]!;

  return {
    type: "github-shorthand",
    owner,
    repo,
    ref: entry.ref,
    manifestKey: `${owner}/${repo}`,
  };
}

function getSourceDir(tempDir: string, key: string): string {
  const parts = key.split("/");
  if (parts.length > 2) {
    const subPath = parts.slice(2).join("/");
    return join(tempDir, subPath);
  }
  return tempDir;
}

export async function runUpdate(key?: string): Promise<void> {
  if (key === undefined) {
    await runAllUpdates();
    return;
  }

  const projectDir = process.cwd();

  const manifest = await readManifest(projectDir).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(`Failed to read manifest: ${message}`);
    throw new ExitSignal(1);
  });

  if (Object.keys(manifest).length === 0) {
    p.outro("No plugins installed.");
    return;
  }

  const targetKeys = resolveTargetKeys(key, manifest);

  let updatedManifest = { ...manifest };
  let hasChanges = false;

  for (const targetKey of targetKeys) {
    const entry = manifest[targetKey]!;
    const newEntry = await runSingleUpdate(targetKey, entry, projectDir);
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

  if (result.status === "local") {
    return runLocalUpdate(key, entry, projectDir);
  }

  // update-available — proceed with clone-then-nuke pipeline
  return runGitUpdate(key, entry, projectDir);
}

async function runGitUpdate(
  key: string,
  entry: ManifestEntry,
  projectDir: string,
): Promise<ManifestEntry | null> {
  const parsed = buildParsedSource(key, entry);
  let tempDir: string | undefined;

  try {
    const spin = p.spinner();
    spin.start("Cloning repository...");

    let cloneResult;
    try {
      cloneResult = await cloneSource(parsed);
    } catch (err) {
      spin.stop("Clone failed");
      throw err;
    }
    spin.stop("Cloned successfully");

    tempDir = cloneResult.tempDir;
    const newCommit = cloneResult.commit;
    const sourceDir = getSourceDir(tempDir, key);

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
      p.log.error(`New version of ${key} has no agntc.json — aborting.`);
      throw new ExitSignal(1);
    }

    if (pipelineResult.status === "no-agents") {
      p.log.warn(
        `Plugin ${key} no longer supports any of your installed agents. ` +
          `No update performed. Run npx agntc remove ${key} to clean up.`,
      );
      return null;
    }

    if (pipelineResult.status === "invalid-type") {
      p.log.error(`New version of ${key} is not a valid plugin — aborting.`);
      throw new ExitSignal(1);
    }

    // Summary
    p.outro(
      renderGitUpdateSummary({
        key,
        oldCommit: entry.commit,
        newCommit,
        copiedFiles: pipelineResult.copiedFiles,
        effectiveAgents: pipelineResult.entry.agents,
        droppedAgents: pipelineResult.droppedAgents,
      }),
    );

    return pipelineResult.entry;
  } catch (err) {
    if (err instanceof ExitSignal) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    p.cancel(message);
    throw new ExitSignal(1);
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

async function validateLocalPath(sourcePath: string): Promise<void> {
  try {
    const stats = await stat(sourcePath);
    if (!stats.isDirectory()) {
      p.log.error(
        `Path ${sourcePath} does not exist or is not a directory.`,
      );
      throw new ExitSignal(1);
    }
  } catch (err) {
    if (err instanceof ExitSignal) throw err;
    p.log.error(
      `Path ${sourcePath} does not exist or is not a directory.`,
    );
    throw new ExitSignal(1);
  }
}

async function runLocalUpdate(
  key: string,
  entry: ManifestEntry,
  projectDir: string,
): Promise<ManifestEntry | null> {
  const sourcePath = key;

  await validateLocalPath(sourcePath);

  const onWarn = (message: string) => p.log.warn(message);

  const pipelineResult = await executeNukeAndReinstall({
    key,
    sourceDir: sourcePath,
    existingEntry: entry,
    projectDir,
    newRef: null,
    newCommit: null,
    onAgentsDropped: (dropped, _kept) => {
      p.log.warn(
        `Plugin ${key} no longer declares support for ${dropped.join(", ")}. ` +
          `Currently installed for: ${entry.agents.join(", ")}. ` +
          `New version supports: ${_kept.join(", ")}.`,
      );
    },
    onWarn,
  });

  if (pipelineResult.status === "no-config") {
    p.log.error(`${key} has no agntc.json — aborting.`);
    throw new ExitSignal(1);
  }

  if (pipelineResult.status === "no-agents") {
    p.log.warn(
      `Plugin ${key} no longer supports any of your installed agents. ` +
        `No update performed. Run npx agntc remove ${key} to clean up.`,
    );
    return null;
  }

  if (pipelineResult.status === "invalid-type") {
    p.log.error(`${key} is not a valid plugin — aborting.`);
    throw new ExitSignal(1);
  }

  p.outro(
    renderLocalUpdateSummary({
      key,
      copiedFiles: pipelineResult.copiedFiles,
      effectiveAgents: pipelineResult.entry.agents,
      droppedAgents: pipelineResult.droppedAgents,
    }),
  );

  return pipelineResult.entry;
}

// --- All-plugins mode helpers ---

interface CheckedPlugin {
  key: string;
  entry: ManifestEntry;
  checkResult: UpdateCheckResult;
}

async function processGitUpdateForAll(
  key: string,
  entry: ManifestEntry,
  projectDir: string,
): Promise<PluginOutcome> {
  const parsed = buildParsedSource(key, entry);
  let tempDir: string | undefined;

  try {
    const cloneResult = await cloneSource(parsed);
    tempDir = cloneResult.tempDir;
    const newCommit = cloneResult.commit;
    const sourceDir = getSourceDir(tempDir, key);

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
        status: "failed",
        key,
        summary: `${key}: Failed — no agntc.json in new version`,
      };
    }

    if (pipelineResult.status === "no-agents") {
      return {
        status: "failed",
        key,
        summary: `${key}: Skipped — no longer supports installed agents`,
      };
    }

    if (pipelineResult.status === "invalid-type") {
      return {
        status: "failed",
        key,
        summary: `${key}: Failed — not a valid plugin in new version`,
      };
    }

    return {
      status: "updated",
      key,
      summary: renderUpdateOutcomeSummary({
        type: "git-update",
        key,
        oldCommit: entry.commit,
        newCommit,
        droppedAgents: pipelineResult.droppedAgents,
      }),
      newEntry: pipelineResult.entry,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      key,
      summary: `${key}: Failed — ${message}`,
    };
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

async function processLocalUpdateForAll(
  key: string,
  entry: ManifestEntry,
  projectDir: string,
): Promise<PluginOutcome> {
  try {
    const sourcePath = key;

    try {
      const stats = await stat(sourcePath);
      if (!stats.isDirectory()) {
        return {
          status: "failed",
          key,
          summary: `${key}: Failed — path is not a directory`,
        };
      }
    } catch {
      return {
        status: "failed",
        key,
        summary: `${key}: Failed — path does not exist`,
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
        status: "failed",
        key,
        summary: `${key}: Failed — no agntc.json`,
      };
    }

    if (pipelineResult.status === "no-agents") {
      return {
        status: "failed",
        key,
        summary: `${key}: Skipped — no longer supports installed agents`,
      };
    }

    if (pipelineResult.status === "invalid-type") {
      return {
        status: "failed",
        key,
        summary: `${key}: Failed — not a valid plugin`,
      };
    }

    return {
      status: "refreshed",
      key,
      summary: renderUpdateOutcomeSummary({
        type: "local-update",
        key,
        droppedAgents: pipelineResult.droppedAgents,
      }),
      newEntry: pipelineResult.entry,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      key,
      summary: `${key}: Failed — ${message}`,
    };
  }
}

async function runAllUpdates(): Promise<void> {
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

  for (const checked of updateAvailable) {
    const outcome = await processGitUpdateForAll(
      checked.key,
      checked.entry,
      projectDir,
    );
    outcomes.push(outcome);
  }

  for (const checked of local) {
    const outcome = await processLocalUpdateForAll(
      checked.key,
      checked.entry,
      projectDir,
    );
    outcomes.push(outcome);
  }

  // Build updated manifest with all successful updates
  let updatedManifest = { ...manifest };
  let hasChanges = false;

  for (const outcome of outcomes) {
    if (
      (outcome.status === "updated" || outcome.status === "refreshed") &&
      "newEntry" in outcome
    ) {
      updatedManifest = addEntry(updatedManifest, outcome.key, outcome.newEntry);
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
  .action(async (key?: string) => {
    try {
      await runUpdate(key);
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
