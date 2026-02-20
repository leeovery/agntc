import type { ManifestEntry } from "./manifest.js";
import type { AgentId } from "./drivers/types.js";
import { readConfig } from "./config.js";
import { detectType } from "./type-detection.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { copyPluginAssets } from "./copy-plugin-assets.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import { getDriver } from "./drivers/registry.js";
import {
  computeEffectiveAgents,
  findDroppedAgents,
} from "./agent-compat.js";

export interface NukeReinstallOptions {
  key: string;
  sourceDir: string;
  existingEntry: ManifestEntry;
  projectDir: string;
  newRef?: string | null;
  newCommit?: string | null;
  onAgentsDropped?: (dropped: AgentId[], newConfigAgents: AgentId[]) => void;
  onWarn?: (message: string) => void;
}

interface NukeReinstallSuccess {
  status: "success";
  entry: ManifestEntry;
  copiedFiles: string[];
  droppedAgents: AgentId[];
}

interface NukeReinstallNoConfig {
  status: "no-config";
}

interface NukeReinstallNoAgents {
  status: "no-agents";
}

interface NukeReinstallInvalidType {
  status: "invalid-type";
}

interface NukeReinstallCopyFailed {
  status: "copy-failed";
  errorMessage: string;
  recoveryHint: string;
}

export type NukeReinstallResult =
  | NukeReinstallSuccess
  | NukeReinstallNoConfig
  | NukeReinstallNoAgents
  | NukeReinstallInvalidType
  | NukeReinstallCopyFailed;

export async function executeNukeAndReinstall(
  options: NukeReinstallOptions,
): Promise<NukeReinstallResult> {
  const {
    sourceDir,
    existingEntry,
    projectDir,
    onAgentsDropped,
    onWarn,
  } = options;

  const ref = options.newRef !== undefined ? options.newRef : existingEntry.ref;
  const commit =
    options.newCommit !== undefined ? options.newCommit : existingEntry.commit;

  // Read config from source
  const config = await readConfig(sourceDir, { onWarn });

  if (config === null) {
    return { status: "no-config" };
  }

  // Agent compatibility check
  const effectiveAgents = computeEffectiveAgents(
    existingEntry.agents,
    config.agents,
  );
  const droppedAgents = findDroppedAgents(
    existingEntry.agents,
    config.agents,
  );

  if (effectiveAgents.length === 0) {
    return { status: "no-agents" };
  }

  if (droppedAgents.length > 0) {
    onAgentsDropped?.(droppedAgents, config.agents);
  }

  // Detect type
  const detected = await detectType(sourceDir, {
    hasConfig: true,
    onWarn,
  });

  if (detected.type === "not-agntc" || detected.type === "collection") {
    return { status: "invalid-type" };
  }

  // Build agent+driver pairs
  const agents = effectiveAgents.map((id) => ({
    id,
    driver: getDriver(id),
  }));

  // Nuke existing files
  await nukeManifestFiles(projectDir, existingEntry.files);

  // Copy from source
  let copiedFiles: string[];

  try {
    if (detected.type === "plugin") {
      const pluginResult = await copyPluginAssets({
        sourceDir,
        assetDirs: detected.assetDirs,
        agents,
        projectDir,
      });
      copiedFiles = pluginResult.copiedFiles;
    } else {
      const bareResult = await copyBareSkill({
        sourceDir,
        projectDir,
        agents,
      });
      copiedFiles = bareResult.copiedFiles;
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: "copy-failed",
      errorMessage,
      recoveryHint:
        `Update failed for ${options.key} after removing old files. ` +
        `The plugin is currently uninstalled. ` +
        `Run \`npx agntc update ${options.key}\` to retry installation.`,
    };
  }

  // Construct new manifest entry
  const entry: ManifestEntry = {
    ref: ref ?? null,
    commit: commit ?? null,
    installedAt: new Date().toISOString(),
    agents: effectiveAgents,
    files: copiedFiles,
  };

  return {
    status: "success",
    entry,
    copiedFiles,
    droppedAgents,
  };
}
