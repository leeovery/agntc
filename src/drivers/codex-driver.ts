import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDriver, AssetType } from "./types.js";

const TARGET_DIRS: Partial<Record<AssetType, string>> = {
	skills: ".agents/skills",
};

export class CodexDriver implements AgentDriver {
	async detect(projectDir: string): Promise<boolean> {
		if (await this.projectHasAgents(projectDir)) {
			return true;
		}

		if (await this.whichCodexSucceeds()) {
			return true;
		}

		return false;
	}

	getTargetDir(assetType: AssetType): string | null {
		return TARGET_DIRS[assetType] ?? null;
	}

	private async projectHasAgents(projectDir: string): Promise<boolean> {
		try {
			await access(join(projectDir, ".agents"));
			return true;
		} catch {
			return false;
		}
	}

	private async whichCodexSucceeds(): Promise<boolean> {
		return new Promise((resolve) => {
			execFile("which", ["codex"], {}, (error: Error | null) => {
				resolve(error === null);
			});
		});
	}
}
