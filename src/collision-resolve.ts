import { formatFileList } from "./format-file-list.js";
import { type Manifest, removeEntry } from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import type { Ui } from "./ui.js";

export interface CollisionResolution {
	resolved: boolean;
	updatedManifest: Manifest;
}

/**
 * Asks, per colliding entry, whether to remove it and carry on or cancel the
 * install. Stops at the first cancel.
 *
 * @param collisions - Map of manifest key to overlapping file paths
 * @param manifest - Current manifest
 * @param projectDir - Project root directory
 */
export async function resolveCollisions(
	collisions: Map<string, string[]>,
	manifest: Manifest,
	projectDir: string,
	ui: Ui,
): Promise<CollisionResolution> {
	let updatedManifest = manifest;

	for (const [key, files] of collisions) {
		ui.box(formatFileList(files), `File collision with "${key}"`);

		const choice = await ui.select({
			message: `How would you like to proceed with "${key}"?`,
			options: [
				{
					value: "remove" as const,
					label: `Remove ${key} and continue`,
				},
				{
					value: "cancel" as const,
					label: "Cancel installation",
				},
			],
		});

		if (choice !== "remove") {
			return { resolved: false, updatedManifest };
		}

		updatedManifest = await removeCollidingEntries(
			[key],
			updatedManifest,
			projectDir,
		);
	}

	return { resolved: true, updatedManifest };
}

/** Deletes each entry's files and drops it from the manifest. */
export async function removeCollidingEntries(
	keys: Iterable<string>,
	manifest: Manifest,
	projectDir: string,
): Promise<Manifest> {
	let updatedManifest = manifest;
	for (const key of keys) {
		const entry = updatedManifest[key];
		if (entry) {
			await nukeManifestFiles(projectDir, entry.files);
			updatedManifest = removeEntry(updatedManifest, key);
		}
	}
	return updatedManifest;
}
