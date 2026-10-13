import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	inspectInstallPath,
	isContainedPath,
	withoutTrailingSlash,
} from "./install-paths.js";

export interface NukeResult {
	removed: string[];
	skipped: string[];
}

/** What became of one path: deleted, nothing to delete, or not ours to delete. */
export type RemoveOutcome = "removed" | "skipped" | "refused";

/**
 * Deletes recorded install paths. One that isn't a plain path below
 * `projectDir`, which only a hand-edited manifest holds, is left alone, and
 * once the rest are done the call fails naming it.
 */
export async function nukeManifestFiles(
	projectDir: string,
	files: string[],
): Promise<NukeResult> {
	const outcomes: Record<RemoveOutcome, string[]> = {
		removed: [],
		skipped: [],
		refused: [],
	};

	for (const entry of files) {
		outcomes[await removeInstallPath(projectDir, entry)].push(entry);
	}

	if (outcomes.refused.length > 0) {
		throw new Error(
			`won't delete ${outcomes.refused.join(", ")} — not a plain path below ${projectDir}`,
		);
	}
	return { removed: outcomes.removed, skipped: outcomes.skipped };
}

/**
 * Removes one install path without following a symlink, so a link to someone's
 * own folder never costs them its contents: a link at the path is unlinked as
 * a link, and a path below a linked folder is left alone. A path that isn't
 * plainly below `projectDir`, such as one using `..`, is refused untouched.
 */
export async function removeInstallPath(
	projectDir: string,
	entry: string,
): Promise<RemoveOutcome> {
	if (!isContainedPath(entry)) {
		return "refused";
	}
	const path = withoutTrailingSlash(entry);
	const state = await inspectInstallPath(projectDir, path);
	switch (state.kind) {
		case "missing":
			return "skipped";
		case "link":
			if (state.at !== path) {
				return "skipped";
			}
			await unlink(join(projectDir, path));
			return "removed";
		case "present":
			await rm(join(projectDir, path), { recursive: entry.endsWith("/") });
			return "removed";
	}
}
