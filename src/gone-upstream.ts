import { errorMessage } from "./errors.js";
import {
	type Manifest,
	type ManifestEntry,
	removeEntry,
	writeManifest,
} from "./manifest.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { agntcCommand, type Scope } from "./scope.js";
import type { Ui } from "./ui.js";

export interface GoneOptions {
	/** `-y`: remove without asking. */
	yes: boolean;
	ui: Ui;
}

/** What became of an entry whose source no longer holds it. */
export interface GoneSettlement {
	removed: boolean;
	message: string;
	/** The flags that would have removed it, when there was no terminal to ask. */
	flags?: string[];
}

/**
 * Removes or keeps an entry gone upstream: `-y` removes it, a terminal asks
 * (no by default), and machine mode keeps it. Removing deletes its files; the
 * caller drops its manifest entry.
 */
export async function settleGone(
	key: string,
	entry: ManifestEntry,
	scope: Scope,
	{ yes, ui }: GoneOptions,
): Promise<GoneSettlement> {
	if (!yes && ui.mode === "machine") {
		const removal = agntcCommand(scope.name, "update", [key, "-y"]);
		return {
			removed: false,
			message: `Kept ${key} — it's gone upstream; ${removal} removes it`,
			flags: ["-y"],
		};
	}
	const remove =
		yes ||
		(await ui.confirm({
			message: `${key} is gone upstream — remove it?`,
			initialValue: false,
		}));
	if (!remove) {
		return {
			removed: false,
			message: `Kept ${key} — it's gone upstream; update will ask again`,
		};
	}
	await nukeManifestFiles(scope.root, entry.files);
	return { removed: true, message: `Removed ${key} — it's gone upstream` };
}

/** What a `list` action reports; `ok` is false when a chosen removal failed. */
export interface ListGoneSettlement {
	ok: boolean;
	message: string;
}

/**
 * Settles an entry a `list` action found gone upstream. `list` only runs at a
 * terminal, so it asks; a removal is recorded at once, and one that fails
 * leaves the entry recorded.
 */
export async function settleGoneInList(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<ListGoneSettlement> {
	try {
		const settled = await settleGone(key, entry, scope, { yes: false, ui });
		if (settled.removed) {
			await writeManifest(scope.root, removeEntry(manifest, key));
		}
		return { ok: true, message: settled.message };
	} catch (err) {
		return {
			ok: false,
			message: `Couldn't remove ${key}: ${errorMessage(err)}; it stays recorded`,
		};
	}
}
