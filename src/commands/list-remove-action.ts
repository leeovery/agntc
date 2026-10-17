import { type EntryAssets, entryKind } from "../entry-assets.js";
import { errorMessage } from "../errors.js";
import type { ListActionResult } from "../list-render.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { removeEntry, writeManifest } from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import {
	removalQuestion,
	removalRow,
	removedRow,
	removeFailedRow,
} from "../remove-render.js";
import type { Scope } from "../scope.js";
import type { Row } from "../terminal/types.js";
import type { Ui } from "../ui.js";

/** The entry as the remove action's rows name it. */
export interface RemovedEntry {
	key: string;
	entry: ManifestEntry;
	/** Its key as a row names it: a local one shortened against the home folder. */
	subject: string;
	/** What it installs, as its question counts it. */
	assets: EntryAssets;
}

/**
 * Asks to remove the entry under the row naming what it installed, then
 * removes it and its files, leaving a row saying which. A removal that fails
 * leaves the entry recorded, so whatever is left stays tracked.
 */
export async function executeRemoveAction(
	{ key, entry, subject, assets }: RemovedEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<ListActionResult> {
	const removed = { entry, assets };
	const kind = entryKind(entry, assets);
	const asked = removalRow(subject, kind, removed);
	const confirmed = await ui.block([asked]).confirm(asked, {
		message: removalQuestion([removed]),
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
