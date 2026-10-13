import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inspectInstallPath, withoutTrailingSlash } from "./install-paths.js";

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
		if (await removeInstallPath(projectDir, entry)) {
			removed.push(entry);
		} else {
			skipped.push(entry);
		}
	}

	return { removed, skipped };
}

/**
 * Removes a recorded path without following a symlink, so a link to someone's
 * own folder never costs them its contents: a link at the path is unlinked as
 * a link, and a path below a linked folder is left alone. False when there was
 * nothing to remove.
 */
async function removeInstallPath(
	projectDir: string,
	entry: string,
): Promise<boolean> {
	const path = withoutTrailingSlash(entry);
	const state = await inspectInstallPath(projectDir, path);
	switch (state.kind) {
		case "missing":
			return false;
		case "link":
			if (state.at !== path) {
				return false;
			}
			await unlink(join(projectDir, path));
			return true;
		case "present":
			await rm(join(projectDir, path), { recursive: entry.endsWith("/") });
			return true;
	}
}
