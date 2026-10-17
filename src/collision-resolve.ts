import { errorMessage } from "./errors.js";
import { collisionRow } from "./in-the-way-render.js";
import { type Manifest, removeEntry } from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { homeShortened } from "./scope.js";
import type { Ui } from "./ui.js";

export interface CollisionResolution {
	resolved: boolean;
	updatedManifest: Manifest;
}

/**
 * Asks, per colliding entry, under its row naming it and the files in the
 * way, whether to remove it and carry on or cancel the install. Stops at the
 * first cancel.
 *
 * @param collisions - Map of manifest key to overlapping file paths
 * @param manifest - Current manifest
 * @param installRoot - The folder `.claude` and `.agntc` sit in, for either scope
 * @param home - The home folder a local entry's row shortens its key against
 */
export async function resolveCollisions(
	collisions: Map<string, string[]>,
	manifest: Manifest,
	installRoot: string,
	ui: Ui,
	home: string,
): Promise<CollisionResolution> {
	let updatedManifest = manifest;

	for (const [key, files] of collisions) {
		const row = collisionRow(homeShortened(key, home), files);
		const choice = await ui.block([row]).select(row, {
			message: "How would you like to proceed?",
			options: [
				{
					value: "remove" as const,
					label: "Remove it and continue",
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
			installRoot,
		);
	}

	return { resolved: true, updatedManifest };
}

/**
 * A removal that failed part way. `manifest` drops the entries removed before
 * it and keeps the one that failed, so whatever is left of it stays tracked.
 */
export class PartialRemovalError extends Error {
	constructor(
		readonly manifest: Manifest,
		cause: unknown,
	) {
		super(errorMessage(cause), { cause });
	}
}

/**
 * Deletes each entry's files and drops it from the manifest. A failed removal
 * throws a `PartialRemovalError`.
 */
export async function removeCollidingEntries(
	keys: Iterable<string>,
	manifest: Manifest,
	installRoot: string,
): Promise<Manifest> {
	let updatedManifest = manifest;
	for (const key of keys) {
		const entry = updatedManifest[key];
		if (entry) {
			try {
				await nukeManifestFiles(installRoot, entry.files);
			} catch (err) {
				throw new PartialRemovalError(updatedManifest, err);
			}
			updatedManifest = removeEntry(updatedManifest, key);
		}
	}
	return updatedManifest;
}
