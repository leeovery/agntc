import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "./manifest.js";

/**
 * Checks incoming file paths against disk for unmanaged conflicts.
 * A file is an "unmanaged conflict" if it exists on disk but is NOT
 * tracked by any manifest entry.
 *
 * @param incomingFiles - Relative file paths about to be installed
 * @param manifest - Current manifest (to exclude tracked files)
 * @param projectDir - Project root directory
 * @returns Array of conflicting relative paths
 */
export async function checkUnmanagedConflicts(
	incomingFiles: string[],
	manifest: Manifest,
	projectDir: string,
): Promise<string[]> {
	if (incomingFiles.length === 0) {
		return [];
	}

	// Collect all tracked files from all manifest entries
	const trackedFiles = new Set<string>();
	for (const entry of Object.values(manifest)) {
		for (const file of entry.files) {
			trackedFiles.add(file);
		}
	}

	const conflicts: string[] = [];

	for (const file of incomingFiles) {
		// Skip if tracked by manifest
		if (trackedFiles.has(file)) {
			continue;
		}

		// Check if it exists on disk
		const fullPath = join(projectDir, file);
		try {
			await stat(fullPath);
			// Exists and is untracked — conflict
			conflicts.push(file);
		} catch {
			// Does not exist — no conflict
		}
	}

	return conflicts;
}
