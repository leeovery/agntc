import * as p from "@clack/prompts";
import type { ManifestEntry } from "./manifest.js";
import type { AgentId } from "./drivers/types.js";
import { buildParsedSourceFromKey, getSourceDirFromKey } from "./source-parser.js";
import { cloneSource, cleanupTempDir } from "./git-clone.js";
import {
  executeNukeAndReinstall,
} from "./nuke-reinstall-pipeline.js";

export interface CloneAndReinstallOptions {
  key: string;
  entry: ManifestEntry;
  projectDir: string;
  newRef?: string;
  newCommit?: string;
  /** Provide to skip cloning (local path). */
  sourceDir?: string;
}

interface CloneReinstallSuccess {
  status: "success";
  manifestEntry: ManifestEntry;
  copiedFiles: string[];
  droppedAgents: AgentId[];
}

interface CloneReinstallFailed {
  status: "failed";
  failureReason:
    | "clone-failed"
    | "no-config"
    | "no-agents"
    | "invalid-type"
    | "copy-failed"
    | "unknown";
  message: string;
}

export type CloneReinstallResult = CloneReinstallSuccess | CloneReinstallFailed;

export function formatAgentsDroppedWarning(
  key: string,
  dropped: AgentId[],
  installedAgents: AgentId[],
  newConfigAgents: AgentId[],
): string {
  return (
    `Plugin ${key} no longer declares support for ${dropped.join(", ")}. ` +
    `Currently installed for: ${installedAgents.join(", ")}. ` +
    `New version supports: ${newConfigAgents.join(", ")}.`
  );
}

export async function cloneAndReinstall(
  options: CloneAndReinstallOptions,
): Promise<CloneReinstallResult> {
  const { key, entry, projectDir } = options;

  // Local path mode: no cloning needed
  if (options.sourceDir !== undefined) {
    return runPipeline({
      key,
      entry,
      projectDir,
      sourceDir: options.sourceDir,
      newRef: options.newRef ?? null,
      newCommit: options.newCommit ?? null,
    });
  }

  // Remote mode: clone first
  const parsed = buildParsedSourceFromKey(
    key,
    options.newRef ?? entry.ref,
    entry.cloneUrl,
  );
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
      return {
        status: "failed",
        failureReason: "clone-failed",
        message,
      };
    }
    spin.stop("Cloned successfully");

    tempDir = cloneResult.tempDir;
    const newCommit = options.newCommit ?? cloneResult.commit;
    const sourceDir = getSourceDirFromKey(tempDir, key);

    return await runPipeline({
      key,
      entry,
      projectDir,
      sourceDir,
      newRef: options.newRef ?? null,
      newCommit,
    });
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

interface PipelineInput {
  key: string;
  entry: ManifestEntry;
  projectDir: string;
  sourceDir: string;
  newRef: string | null;
  newCommit: string | null;
}

async function runPipeline(input: PipelineInput): Promise<CloneReinstallResult> {
  const { key, entry, projectDir, sourceDir, newRef, newCommit } = input;

  const onWarn = (message: string) => p.log.warn(message);

  const pipelineResult = await executeNukeAndReinstall({
    key,
    sourceDir,
    existingEntry: entry,
    projectDir,
    newRef,
    newCommit,
    onAgentsDropped: (dropped, newConfigAgents) => {
      p.log.warn(
        formatAgentsDroppedWarning(key, dropped, entry.agents, newConfigAgents),
      );
    },
    onWarn,
  });

  if (pipelineResult.status === "no-config") {
    return {
      status: "failed",
      failureReason: "no-config",
      message: `${key} has no agntc.json`,
    };
  }

  if (pipelineResult.status === "no-agents") {
    return {
      status: "failed",
      failureReason: "no-agents",
      message: `Plugin ${key} no longer supports any of your installed agents`,
    };
  }

  if (pipelineResult.status === "invalid-type") {
    return {
      status: "failed",
      failureReason: "invalid-type",
      message: `${key} is not a valid plugin`,
    };
  }

  if (pipelineResult.status === "copy-failed") {
    return {
      status: "failed",
      failureReason: "copy-failed",
      message: pipelineResult.recoveryHint,
    };
  }

  return {
    status: "success",
    manifestEntry: pipelineResult.entry,
    copiedFiles: pipelineResult.copiedFiles,
    droppedAgents: pipelineResult.droppedAgents,
  };
}
