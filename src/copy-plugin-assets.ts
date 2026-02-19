import { cp, mkdir, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { AgentDriver, AgentId } from "./drivers/types.js";

interface AgentWithDriver {
  id: AgentId;
  driver: AgentDriver;
}

export interface CopyPluginAssetsInput {
  sourceDir: string;
  assetDirs: string[];
  agents: AgentWithDriver[];
  projectDir: string;
}

export interface AssetCounts {
  [assetType: string]: number;
}

export interface CopyPluginAssetsResult {
  copiedFiles: string[];
  assetCountsByAgent: Record<string, AssetCounts>;
}

export async function copyPluginAssets(
  input: CopyPluginAssetsInput,
): Promise<CopyPluginAssetsResult> {
  const { sourceDir, assetDirs, agents, projectDir } = input;
  const copiedFilesSet = new Set<string>();
  const assetCountsByAgent: Record<string, AssetCounts> = {};

  for (const agent of agents) {
    const counts: AssetCounts = {};

    for (const assetDir of assetDirs) {
      const targetDir = agent.driver.getTargetDir(assetDir);
      if (targetDir === null) {
        continue;
      }

      counts[assetDir] = await copyAssetDir(
        join(sourceDir, assetDir),
        join(projectDir, targetDir),
        targetDir,
        copiedFilesSet,
      );
    }

    assetCountsByAgent[agent.id] = counts;
  }

  return {
    copiedFiles: [...copiedFilesSet],
    assetCountsByAgent,
  };
}

async function copyAssetDir(
  assetSourceDir: string,
  destBaseDir: string,
  targetDir: string,
  copiedFilesSet: Set<string>,
): Promise<number> {
  const topEntries = await readTopEntries(assetSourceDir);

  for (const entry of topEntries) {
    const src = join(assetSourceDir, entry.name);
    const dest = join(destBaseDir, entry.name);

    if (entry.isDirectory) {
      await mkdir(dest, { recursive: true });
      await cp(src, dest, { recursive: true });
      await collectDirPaths(dest, targetDir + "/" + entry.name, copiedFilesSet);
    } else {
      await mkdir(destBaseDir, { recursive: true });
      await cp(src, dest);
      copiedFilesSet.add(targetDir + "/" + entry.name);
    }
  }

  return topEntries.length;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

async function readTopEntries(dir: string): Promise<DirEntry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e: Dirent) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch {
    return [];
  }
}

async function collectDirPaths(
  dir: string,
  relPrefix: string,
  set: Set<string>,
): Promise<void> {
  set.add(relPrefix + "/");

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryRel = relPrefix + "/" + entry.name;
    if (entry.isDirectory()) {
      await collectDirPaths(join(dir, entry.name), entryRel, set);
    } else {
      set.add(entryRel);
    }
  }
}
