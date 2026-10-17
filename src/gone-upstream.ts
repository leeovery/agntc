import { assetSummary, countAssets, kindAndCounts } from "./entry-assets.js";
import type { EntryHead } from "./entry-head.js";
import type { ManifestEntry } from "./manifest.js";
import type { SubjectMessage } from "./message.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { installedFolders, removalQuestion } from "./remove-render.js";
import { agntcCommand, type Scope } from "./scope.js";
import type { Row } from "./terminal/types.js";
import type { Ui } from "./ui.js";

export interface GoneOptions {
	/** `-y`: remove without asking. */
	yes: boolean;
	ui: Ui;
	/** How the question's row names the entry: a local one as the row it settles into does. */
	head: EntryHead;
}

/** What became of an entry whose source no longer holds it. */
export interface GoneSettlement {
	removed: boolean;
	message: SubjectMessage;
	/** The flags that would have removed it, when there was no terminal to ask. */
	flags?: string[];
}

/**
 * Removes or keeps an entry gone upstream: `-y` removes it, a terminal asks
 * under the entry's row (no by default), and machine mode keeps it. Removing
 * deletes its files; the caller drops its manifest entry.
 */
export async function settleGone(
	key: string,
	entry: ManifestEntry,
	scope: Scope,
	{ yes, ui, head }: GoneOptions,
): Promise<GoneSettlement> {
	if (!yes && ui.mode === "machine") {
		const removal = agntcCommand(scope.name, "update", [key, "-y"]);
		return {
			...settled(key, "Kept", `it's gone upstream; ${removal} removes it`),
			flags: ["-y"],
		};
	}
	const remove = yes || (await askToRemove(head, entry, scope, ui));
	if (!remove) {
		return settled(key, "Kept", "it's gone upstream; update will ask again");
	}
	await nukeManifestFiles(scope.root, entry.files);
	return settled(key, "Removed", "it's gone upstream");
}

/** Asks under the entry's row, which names it, its kind and counts, and what it installed. */
async function askToRemove(
	head: EntryHead,
	entry: ManifestEntry,
	scope: Scope,
	ui: Ui,
): Promise<boolean> {
	const assets = await countAssets(entry, scope.root);
	const kind = kindAndCounts(entry, assetSummary(entry, assets));
	const row = goneRow(head, kind, entry.files);
	return ui.block([row]).confirm(row, {
		message: removalQuestion([{ entry, assets }]),
		initialValue: false,
	});
}

function settled(
	key: string,
	verb: "Kept" | "Removed",
	why: string,
): GoneSettlement {
	return { removed: verb === "Removed", message: goneMessage(key, verb, why) };
}

/** `<verb> <key> — <why>`, of an entry gone upstream. */
export function goneMessage(
	key: string,
	verb: "Kept" | "Removed",
	why: string,
): SubjectMessage {
	const text = `${verb} ${key} — ${why}`;
	return {
		subject: key,
		detail: `${verb.toLowerCase()} — ${why}`,
		text,
		plain: text,
	};
}

/**
 * An entry gone upstream, as `update` asks whether to remove it: its head, a
 * local one's meta with it as the row it settles into has, its kind and
 * counts, then what it installed under each asset folder.
 */
export function goneRow(
	head: EntryHead,
	kind: string,
	files: readonly string[],
): Row {
	return {
		status: "attention",
		...head,
		detail: { label: "gone upstream", aside: kind },
		fields: installedFolders(files),
	};
}
