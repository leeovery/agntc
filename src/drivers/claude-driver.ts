import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentDriver, AssetType } from "./types.js";

const TARGET_DIRS: Record<AssetType, string> = {
  skills: ".claude/skills",
  agents: ".claude/agents",
  hooks: ".claude/hooks",
};

export class ClaudeDriver implements AgentDriver {
  async detect(projectDir: string): Promise<boolean> {
    if (await this.projectHasClaude(projectDir)) {
      return true;
    }

    if (await this.whichClaudeSucceeds()) {
      return true;
    }

    if (await this.homeDirHasClaude()) {
      return true;
    }

    return false;
  }

  getTargetDir(assetType: AssetType): string | null {
    return TARGET_DIRS[assetType] ?? null;
  }

  private async projectHasClaude(projectDir: string): Promise<boolean> {
    try {
      await access(join(projectDir, ".claude"));
      return true;
    } catch {
      return false;
    }
  }

  private async whichClaudeSucceeds(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("which", ["claude"], {}, (error: Error | null) => {
        resolve(error === null);
      });
    });
  }

  private async homeDirHasClaude(): Promise<boolean> {
    try {
      await access(join(homedir(), ".claude"));
      return true;
    } catch {
      return false;
    }
  }
}
