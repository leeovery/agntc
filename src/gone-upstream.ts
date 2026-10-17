import type { ManifestEntry } from "./manifest.js";
import type { SubjectMessage } from "./message.js";
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
	message: SubjectMessage;
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
			...settled(key, "Kept", `it's gone upstream; ${removal} removes it`),
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
		return settled(key, "Kept", "it's gone upstream; update will ask again");
	}
	await nukeManifestFiles(scope.root, entry.files);
	return settled(key, "Removed", "it's gone upstream");
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
