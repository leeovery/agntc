import { installPathMatcher } from "./install-paths.js";
import type { Manifest } from "./manifest.js";

/**
 * Checks incoming files against manifest entries for path collisions.
 * Returns a Map where keys are manifest entry keys and values are
 * the overlapping file paths.
 *
 * @param incomingFiles - File paths about to be installed
 * @param manifest - Current manifest
 * @param excludeKey - Manifest key to exclude (for reinstall scenarios)
 */
export function checkFileCollisions(
	incomingFiles: string[],
	manifest: Manifest,
	excludeKey?: string,
): Map<string, string[]> {
	const collisions = new Map<string, string[]>();

	if (incomingFiles.length === 0) {
		return collisions;
	}

	const isIncoming = installPathMatcher(incomingFiles);

	for (const [key, entry] of Object.entries(manifest)) {
		if (key === excludeKey) continue;

		const overlapping = entry.files.filter(isIncoming);

		if (overlapping.length > 0) {
			collisions.set(key, overlapping);
		}
	}

	return collisions;
}
