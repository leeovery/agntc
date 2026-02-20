import { access, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { AssetType } from "./drivers/types.js";

export const ASSET_DIRS = ["skills", "agents", "hooks"] as const satisfies readonly AssetType[];

interface BareSkill {
  type: "bare-skill";
}

interface Plugin {
  type: "plugin";
  assetDirs: AssetType[];
}

interface Collection {
  type: "collection";
  plugins: string[];
}

interface NotAgntc {
  type: "not-agntc";
}

export type DetectedType = BareSkill | Plugin | Collection | NotAgntc;

export interface DetectTypeOptions {
  hasConfig: boolean;
  onWarn?: (message: string) => void;
}

export async function detectType(
  dir: string,
  options: DetectTypeOptions,
): Promise<DetectedType> {
  const { hasConfig, onWarn } = options;

  if (hasConfig) {
    return detectWithConfig(dir, onWarn);
  }

  return detectWithoutConfig(dir);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectWithConfig(
  dir: string,
  onWarn?: (message: string) => void,
): Promise<DetectedType> {
  const foundAssetDirs: AssetType[] = [];
  for (const assetDir of ASSET_DIRS) {
    if (await exists(join(dir, assetDir))) {
      foundAssetDirs.push(assetDir);
    }
  }

  const hasSkillMd = await exists(join(dir, "SKILL.md"));

  if (foundAssetDirs.length > 0) {
    if (hasSkillMd) {
      onWarn?.(
        "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
      );
    }
    return { type: "plugin", assetDirs: foundAssetDirs };
  }

  if (hasSkillMd) {
    return { type: "bare-skill" };
  }

  onWarn?.("agntc.json present but no SKILL.md or asset dirs found");
  return { type: "not-agntc" };
}

async function detectWithoutConfig(dir: string): Promise<DetectedType> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { type: "not-agntc" };
  }

  const plugins: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (await exists(join(dir, entry.name, "agntc.json"))) {
      plugins.push(entry.name);
    }
  }

  if (plugins.length > 0) {
    return { type: "collection", plugins };
  }

  return { type: "not-agntc" };
}
