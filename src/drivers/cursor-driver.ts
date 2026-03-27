import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentDriver, AssetType } from "./types.js";

const TARGET_DIRS: Partial<Record<AssetType, string>> = {
	skills: ".cursor/skills",
};

export class CursorDriver implements AgentDriver {
	async detect(projectDir: string): Promise<boolean> {
		if (await this.projectHasCursor(projectDir)) {
			return true;
		}

		if (await this.whichCursorSucceeds()) {
			return true;
		}

		if (await this.homeDirHasCursor()) {
			return true;
		}

		return false;
	}

	getTargetDir(assetType: AssetType): string | null {
		return TARGET_DIRS[assetType] ?? null;
	}

	private async projectHasCursor(projectDir: string): Promise<boolean> {
		try {
			await access(join(projectDir, ".cursor"));
			return true;
		} catch {
			return false;
		}
	}

	private async whichCursorSucceeds(): Promise<boolean> {
		return new Promise((resolve) => {
			execFile("which", ["cursor"], {}, (error: Error | null) => {
				resolve(error === null);
			});
		});
	}

	private async homeDirHasCursor(): Promise<boolean> {
		try {
			await access(join(homedir(), ".cursor"));
			return true;
		} catch {
			return false;
		}
	}
}
