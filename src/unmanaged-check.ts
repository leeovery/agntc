import {
	inspectInstallPath,
	installPathMatcher,
	withoutTrailingSlash,
} from "./install-paths.js";
import type { Manifest } from "./manifest.js";

/**
 * Checks incoming file paths against disk for unmanaged conflicts: whatever
 * stands where an incoming file would go and no manifest entry tracks. A
 * symlink counts, dangling or not, and so does a symlinked folder the item
 * owns above the file, which is reported in the file's place.
 *
 * @param incomingFiles - Relative file paths about to be installed
 * @param manifest - Current manifest (to exclude tracked files)
 * @param installRoot - The folder `.claude` and `.agntc` sit in, for either scope
 * @returns The conflicting relative paths, each once
 */
export async function checkUnmanagedConflicts(
	incomingFiles: string[],
	manifest: Manifest,
	installRoot: string,
): Promise<string[]> {
	const isTracked = installPathMatcher(
		Object.values(manifest).flatMap((entry) => entry.files),
	);
	const conflicts = new Set<string>();

	for (const file of incomingFiles) {
		const inTheWay = await findInTheWay(installRoot, file);
		if (inTheWay !== null && !isTracked(inTheWay)) {
			conflicts.add(inTheWay);
		}
	}

	return [...conflicts];
}

async function findInTheWay(
	installRoot: string,
	file: string,
): Promise<string | null> {
	const state = await inspectInstallPath(installRoot, file);
	if (state.kind === "link" && state.at !== withoutTrailingSlash(file)) {
		return state.at;
	}
	return state.kind === "missing" ? null : file;
}
