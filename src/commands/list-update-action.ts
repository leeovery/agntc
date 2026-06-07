import {
	buildAbortMessage,
	cloneAndReinstall,
	isCloneReinstallFailure,
	mapCloneFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
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
		const prepared = await prepareReinstall(key, entry, projectDir, {
			manifest,
			...overrides,
		});
		if (!prepared.ok) {
			return {
				success: false,
				message: `Path ${key} does not exist or is not a directory`,
			};
		}

		const result = await cloneAndReinstall(prepared.options);

		if (isCloneReinstallFailure(result)) {
			return mapCloneFailure<UpdateActionResult>(result, {
				onCloneFailed: (msg) => ({ success: false, message: msg }),
				onNoAgents: (msg) => ({ success: false, message: msg }),
				onCopyFailed: (msg) => ({ success: false, message: msg }),
				onUnknown: (msg) => ({ success: false, message: msg }),
				// Derive-before-delete abort: full recorded-vs-current message +
				// remove+add remedy via the canonical builder. Install intact.
				onAborted: (recordedType, reason) => ({
					success: false,
					message: buildAbortMessage(key, recordedType, reason),
				}),
			});
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
