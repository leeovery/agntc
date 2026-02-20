import { basename } from "node:path";
import type { AgentWithDriver, AssetType } from "./drivers/types.js";

interface BareSkillInput {
  type: "bare-skill";
  sourceDir: string;
  agents: AgentWithDriver[];
}

interface PluginInput {
  type: "plugin";
  assetDirs: AssetType[];
  agents: AgentWithDriver[];
}

type ComputeInput = BareSkillInput | PluginInput;

/**
 * Predicts the file paths that would be produced by copy operations,
 * without actually copying. Used for collision and unmanaged checks
 * before copy begins.
 */
export function computeIncomingFiles(input: ComputeInput): string[] {
  if (input.type === "bare-skill") {
    return computeBareSkillFiles(input);
  }
  return computePluginFiles(input);
}

function computeBareSkillFiles(input: BareSkillInput): string[] {
  const skillName = basename(input.sourceDir);
  const files: string[] = [];

  for (const agent of input.agents) {
    const targetDir = agent.driver.getTargetDir("skills");
    if (targetDir === null) {
      continue;
    }
    files.push(`${targetDir}/${skillName}/`);
  }

  return files;
}

function computePluginFiles(input: PluginInput): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const agent of input.agents) {
    for (const assetDir of input.assetDirs) {
      const targetDir = agent.driver.getTargetDir(assetDir);
      if (targetDir === null) {
        continue;
      }
      const path = `${targetDir}/`;
      if (!seen.has(path)) {
        seen.add(path);
        files.push(path);
      }
    }
  }

  return files;
}
