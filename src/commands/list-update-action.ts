import {
	cloneAndReinstall,
	failureMessage,
	isCloneReinstallFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
import { settleGoneInList } from "../gone-upstream.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, removeEntry, writeManifest } from "../manifest.js";
import type { Ui } from "../ui.js";
import type { VersionOverrides } from "../version-resolve.js";

export interface UpdateActionResult {
	success: boolean;
	newEntry?: ManifestEntry;
	message: string;
	notes: string[];
}

export async function executeUpdateAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	ui: Ui,
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
				notes: [],
			};
		}

		const result = await cloneAndReinstall(prepared.options, ui, manifest);

		if (result.status === "gone") {
			const settled = await settleGoneInList(
				key,
				entry,
				manifest,
				projectDir,
				ui,
			);
			return { success: true, message: settled.message, notes: [] };
		}
		if (isCloneReinstallFailure(result)) {
			return {
				success: false,
				message: failureMessage(result, key, entry),
				notes: [],
			};
		}

		const rest = result.absorbed.reduce(removeEntry, manifest);
		await writeManifest(projectDir, addEntry(rest, key, result.manifestEntry));

		return {
			success: true,
			newEntry: result.manifestEntry,
			message: isLocal ? `Refreshed ${key}` : `Updated ${key}`,
			notes: result.notes,
		};
	} catch (err) {
		return { success: false, message: errorMessage(err), notes: [] };
	}
}
