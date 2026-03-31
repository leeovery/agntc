import { isCancel, note, select } from "@clack/prompts";
import { formatFileList } from "./format-file-list.js";
import type { Manifest } from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";

export interface CollisionResolution {
	resolved: boolean;
	updatedManifest: Manifest;
}

/**
 * Interactively resolves file path collisions with existing manifest entries.
 * For each colliding plugin, prompts user to either remove it or cancel.
 * Processes collisions sequentially — stops immediately on cancel.
 *
 * @param collisions - Map of manifest key to overlapping file paths
 * @param manifest - Current manifest
 * @param projectDir - Project root directory
 */
export async function resolveCollisions(
	collisions: Map<string, string[]>,
	manifest: Manifest,
	projectDir: string,
): Promise<CollisionResolution> {
	if (collisions.size === 0) {
		return { resolved: true, updatedManifest: manifest };
	}

	let updatedManifest = { ...manifest };

	for (const [key, files] of collisions) {
		const fileList = formatFileList(files);

		note(fileList, `File collision with "${key}"`);

		const choice = await select({
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

		if (isCancel(choice) || choice === "cancel") {
			return { resolved: false, updatedManifest };
		}

		// choice === "remove"
		const entry = updatedManifest[key];
		if (entry) {
			await nukeManifestFiles(projectDir, entry.files);
			const { [key]: _, ...rest } = updatedManifest;
			updatedManifest = rest;
		}
	}

	return { resolved: true, updatedManifest };
}
