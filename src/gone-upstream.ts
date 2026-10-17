import { assetSummary, kindAndCounts } from "./entry-assets.js";
import type { ManifestEntry } from "./manifest.js";
import type { SubjectMessage } from "./message.js";
import { nukeManifestFiles } from "./nuke-files.js";
import { goneRow, removalQuestion } from "./remove-render.js";
import { agntcCommand, homeShortened, type Scope } from "./scope.js";
import type { Ui } from "./ui.js";

export interface GoneOptions {
	/** `-y`: remove without asking. */
	yes: boolean;
	ui: Ui;
	/** The home folder a local entry's row shortens its path against. */
	home: string;
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
	{ yes, ui, home }: GoneOptions,
): Promise<GoneSettlement> {
	if (!yes && ui.mode === "machine") {
		const removal = agntcCommand(scope.name, "update", [key, "-y"]);
		return {
			...settled(key, "Kept", `it's gone upstream; ${removal} removes it`),
			flags: ["-y"],
		};
	}
	const remove = yes || (await askToRemove(key, entry, scope, ui, home));
	if (!remove) {
		return settled(key, "Kept", "it's gone upstream; update will ask again");
	}
	await nukeManifestFiles(scope.root, entry.files);
	return settled(key, "Removed", "it's gone upstream");
}

/** Asks under the entry's row, which names it, its kind and counts, and what it installed. */
async function askToRemove(
	key: string,
	entry: ManifestEntry,
	scope: Scope,
	ui: Ui,
	home: string,
): Promise<boolean> {
	const subject = entry.commit === null ? homeShortened(key, home) : key;
	const kind = kindAndCounts(entry, await assetSummary(entry, scope.root));
	const row = goneRow(subject, kind, entry.files);
	return ui.block([row]).confirm(row, {
		message: removalQuestion([entry.files]),
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
