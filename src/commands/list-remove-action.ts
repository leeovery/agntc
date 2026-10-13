import { errorMessage } from "../errors.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { removeEntry, writeManifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import type { Scope } from "../scope.js";
import type { Ui } from "../ui.js";

export interface RemoveActionResult {
	removed: boolean;
	message: string;
}

export async function executeRemoveAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<RemoveActionResult> {
	for (const file of entry.files) {
		ui.log.message(`  ${file}`);
	}

	const confirmed = await ui.confirm({
		message: `Remove ${key}? ${entry.files.length} file(s) will be deleted.`,
	});

	if (!confirmed) {
		return { removed: false, message: "Cancelled" };
	}

	try {
		await nukeManifestFiles(scope.root, entry.files);
	} catch (err) {
		return {
			removed: false,
			message: `Couldn't remove ${key}: ${errorMessage(err)}; it stays recorded`,
		};
	}
	await writeManifest(scope.root, removeEntry(manifest, key));

	return { removed: true, message: `Removed ${key}` };
}
