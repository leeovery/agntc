import { inspectInstallPath, withoutTrailingSlash } from "./install-paths.js";
import type { Manifest } from "./manifest.js";

/**
 * Checks incoming file paths against disk for unmanaged conflicts: whatever
 * stands where an incoming file would go and no manifest entry tracks. A
 * symlink counts, dangling or not, and so does a symlinked folder the item
 * owns above the file, which is reported in the file's place.
 *
 * @param incomingFiles - Relative file paths about to be installed
 * @param manifest - Current manifest (to exclude tracked files)
 * @param projectDir - Project root directory
 * @returns The conflicting relative paths, each once
 */
export async function checkUnmanagedConflicts(
	incomingFiles: string[],
	manifest: Manifest,
	projectDir: string,
): Promise<string[]> {
	const tracked = new Set(
		Object.values(manifest).flatMap((entry) => entry.files),
	);
	const conflicts = new Set<string>();

	for (const file of incomingFiles) {
		const inTheWay = await findInTheWay(projectDir, file);
		if (inTheWay !== null && !tracked.has(inTheWay)) {
			conflicts.add(inTheWay);
		}
	}

	return [...conflicts];
}

async function findInTheWay(
	projectDir: string,
	file: string,
): Promise<string | null> {
	const state = await inspectInstallPath(projectDir, file);
	if (state.kind === "link" && state.at !== withoutTrailingSlash(file)) {
		return state.at;
	}
	return state.kind === "missing" ? null : file;
}
