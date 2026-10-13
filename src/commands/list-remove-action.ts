import type { Manifest, ManifestEntry } from "../manifest.js";
import { writeManifest } from "../manifest.js";
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

	await nukeManifestFiles(scope.root, entry.files);

	const updated: Manifest = {};
	for (const [k, v] of Object.entries(manifest)) {
		if (k !== key) {
			updated[k] = v;
		}
	}
	await writeManifest(scope.root, updated);

	return { removed: true, message: `Removed ${key}` };
}
