import { buildFailureMessage, cloneAndReinstall } from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
import { validateLocalSourcePath } from "../fs-utils.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, writeManifest } from "../manifest.js";
import type { VersionOverrides } from "../version-resolve.js";

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
	overrides?: VersionOverrides,
): Promise<UpdateActionResult> {
	return runUpdate(key, entry, manifest, projectDir, overrides);
}

async function runUpdate(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	overrides?: VersionOverrides,
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
			const message = buildFailureMessage(result, key);
			return { success: false, message };
		}

		if (result.status === "aborted") {
			// Structured abort plumbed from derive-before-delete; full message +
			// remedy assembled by reporting (configless-install 4-6).
			return {
				success: false,
				message: `${key} update aborted: ${result.reason}. Existing install left intact.`,
			};
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
