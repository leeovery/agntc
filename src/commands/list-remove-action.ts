import { errorMessage } from "../errors.js";
import type { ListActionResult } from "../list-render.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { removeEntry, writeManifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { removalRow, removedRow, removeFailedRow } from "../remove-render.js";
import type { Scope } from "../scope.js";
import type { Row } from "../terminal/types.js";
import type { Ui } from "../ui.js";

/** The entry as the remove action's rows name it. */
export interface RemovedEntry {
	key: string;
	entry: ManifestEntry;
	/** Its key as a row names it: a local one shortened against the home folder. */
	subject: string;
	/** Its kind, a pack's with what it installs. */
	kind: string;
}

/**
 * Asks to remove the entry under the row naming what it installed, then
 * removes it and its files, leaving a row saying which. A removal that fails
 * leaves the entry recorded, so whatever is left stays tracked.
 */
export async function executeRemoveAction(
	{ key, entry, subject, kind }: RemovedEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<ListActionResult> {
	const asked = removalRow(subject, kind, entry.files);
	const confirmed = await ui.block([asked]).confirm(asked, {
		message: `Remove ${key}? ${entry.files.length} file(s) will be deleted.`,
	});
	if (!confirmed) {
		return { key, change: null };
	}

	const said = (row: Row) => ui.block([row]).row(row);
	try {
		await nukeManifestFiles(scope.root, entry.files);
	} catch (err) {
		said(removeFailedRow(subject, errorMessage(err)));
		return { key, change: null };
	}
	await writeManifest(scope.root, removeEntry(manifest, key));
	said(removedRow(subject, kind));
	return { key, change: "removed" };
}
