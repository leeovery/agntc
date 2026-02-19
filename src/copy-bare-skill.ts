import { cp, mkdir, rm, access } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { AgentDriver, AgentId } from "./drivers/types.js";

interface AgentWithDriver {
  id: AgentId;
  driver: AgentDriver;
}

export interface CopyBareSkillInput {
  sourceDir: string;
  projectDir: string;
  agents: AgentWithDriver[];
}

export interface CopyBareSkillResult {
  copiedFiles: string[];
}

export async function copyBareSkill(
  input: CopyBareSkillInput,
): Promise<CopyBareSkillResult> {
  const { sourceDir, projectDir, agents } = input;
  const skillName = basename(sourceDir);
  const copiedFiles: string[] = [];

  for (const agent of agents) {
    const targetDir = agent.driver.getTargetDir("skills");
    if (targetDir === null) {
      continue;
    }

    const destDir = join(projectDir, targetDir, skillName);
    await mkdir(destDir, { recursive: true });
    await cp(sourceDir, destDir, { recursive: true });

    await removeIfExists(join(destDir, "agntc.json"));

    const relativePath = relative(projectDir, destDir) + "/";
    copiedFiles.push(relativePath);
  }

  return { copiedFiles };
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await access(path);
    await rm(path);
  } catch {
    // File doesn't exist, nothing to remove
  }
}
