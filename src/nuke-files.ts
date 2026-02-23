import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "./errors.js";

export interface NukeResult {
	removed: string[];
	skipped: string[];
}

export async function nukeManifestFiles(
	projectDir: string,
	files: string[],
): Promise<NukeResult> {
	const removed: string[] = [];
	const skipped: string[] = [];

	for (const entry of files) {
		const fullPath = join(projectDir, entry);
		const isDir = entry.endsWith("/");

		try {
			await rm(fullPath, { recursive: isDir, force: false });
			removed.push(entry);
		} catch (err: unknown) {
			if (isNodeError(err) && err.code === "ENOENT") {
				skipped.push(entry);
				continue;
			}
			throw err;
		}
	}

	return { removed, skipped };
}
