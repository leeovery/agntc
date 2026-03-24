import { buildFailureMessage, cloneAndReinstall } from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
import { validateLocalSourcePath } from "../fs-utils.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, writeManifest } from "../manifest.js";

export interface UpdateActionOverrides {
	newRef: string;
	newCommit: string;
}

export interface UpdateActionResult {
	success: boolean;
	newEntry?: ManifestEntry;
	message: string;
}

export async function executeUpdateAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	overrides?: UpdateActionOverrides,
): Promise<UpdateActionResult> {
	return runUpdate(key, entry, manifest, projectDir, overrides);
}

async function runUpdate(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	overrides?: UpdateActionOverrides,
): Promise<UpdateActionResult> {
	const isLocal = entry.commit === null;

	try {
		if (isLocal) {
			const pathResult = await validateLocalSourcePath(key);
			if (!pathResult.valid) {
				return {
					success: false,
					message: `Path ${key} does not exist or is not a directory`,
				};
			}
		}

		const result = await cloneAndReinstall({
			key,
			entry,
			projectDir,
			manifest,
			...(isLocal ? { sourceDir: key } : {}),
			...overrides,
		});

		if (result.status === "failed") {
			const message = buildFailureMessage(result, key, {
				isChangeVersion: !isLocal,
			});
			return { success: false, message };
		}

		const updated = addEntry(manifest, key, result.manifestEntry);
		await writeManifest(projectDir, updated);

		return {
			success: true,
			newEntry: result.manifestEntry,
			message: isLocal ? `Refreshed ${key}` : `Updated ${key}`,
		};
	} catch (err) {
		return { success: false, message: errorMessage(err) };
	}
}
