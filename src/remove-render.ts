import { LOOKS } from "./terminal/tally.js";
import type { Field, Row } from "./terminal/types.js";

/** How many segments name an asset folder, as `.claude/skills/` does. */
const FOLDER_DEPTH = 2;

/** What one of an asset folder's items is, by the folder's name. */
const NOUNS: Readonly<Record<string, string>> = {
	skills: "folder",
	agents: "agent",
	hooks: "hook",
};

/**
 * What an entry's recorded paths install, a field per asset folder they lie
 * in (`.claude/skills/`, `.claude/agents/`, a legacy `.agents/skills/`), in
 * the order recorded, each naming once the folders and files in it they are
 * or lie in, by the noun its items are counted with when it's cut short.
 */
export function installedFolders(files: readonly string[]): Field[] {
	const folders = new Map<string, string[]>();
	for (const file of files) {
		const segments = file.split("/").filter((segment) => segment !== "");
		const depth = Math.min(FOLDER_DEPTH, segments.length - 1);
		const folder = segments
			.slice(0, depth)
			.map((segment) => `${segment}/`)
			.join("");
		const item = segments[depth];
		if (item === undefined) {
			continue;
		}
		const items = folders.get(folder) ?? [];
		if (!items.includes(item)) {
			folders.set(folder, [...items, item]);
		}
	}
	return [...folders].map(([label, value]) => {
		const noun = NOUNS[label.split("/").at(-2) ?? ""];
		return { label, value, ...(noun === undefined ? {} : { noun }) };
	});
}

/**
 * The entry `remove` asks about: its kind and counts, then what it installed
 * under each asset folder.
 */
export function removalRow(
	subject: string,
	kind: string,
	files: readonly string[],
): Row {
	return {
		status: "subject",
		subject,
		detail: kind,
		fields: installedFolders(files),
	};
}

/** An entry removed, with its kind and counts. */
export function removedRow(subject: string, kind: string): Row {
	return {
		status: "done",
		subject,
		detail: { label: LOOKS.remove.removed.label, aside: kind },
	};
}

/** An entry whose files couldn't be removed, which stays recorded. */
export function removeFailedRow(subject: string, reason: string): Row {
	return {
		status: "failed",
		subject,
		detail: {
			label: LOOKS.remove.failed.label,
			aside: `${reason}; it stays recorded`,
		},
	};
}
