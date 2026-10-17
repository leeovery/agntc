import { joinWithAnd, pluralize } from "./summary.js";
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

/** What a question counts an item in a folder with no noun of its own as. */
const ITEM = "item";

interface AssetFolder {
	label: string;
	items: string[];
	noun?: string;
}

/**
 * The asset folders an entry's recorded paths lie in, in the order recorded,
 * each with the folders and files in it they are or lie in, once each.
 */
function assetFolders(files: readonly string[]): AssetFolder[] {
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
	return [...folders].map(([label, items]) => {
		const noun = NOUNS[label.split("/").at(-2) ?? ""];
		return { label, items, ...(noun === undefined ? {} : { noun }) };
	});
}

/**
 * What an entry's recorded paths install, a field per asset folder they lie
 * in (`.claude/skills/`, `.claude/agents/`, a legacy `.agents/skills/`), in
 * the order recorded, each naming once the folders and files in it they are
 * or lie in, by the noun its items are counted with when it's cut short.
 */
export function installedFolders(files: readonly string[]): Field[] {
	return assetFolders(files).map(({ label, items, noun }) => ({
		label,
		value: items,
		...(noun === undefined ? {} : { noun }),
	}));
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

/**
 * The question asked under the rows of entries recording `entries`' files:
 * whether to remove them and what their rows show, counted by noun across
 * them, in the order the nouns first come. `Remove it and its 9 folders and
 * 1 agent?`, `Remove them and their 14 folders?`; a lone item by its noun
 * alone, `Remove it and its folder?`; nothing recorded, `Remove it?`.
 */
export function removalQuestion(
	entries: readonly (readonly string[])[],
): string {
	const [it, its] = entries.length === 1 ? ["it", "its"] : ["them", "their"];
	const counts = new Map<string, number>();
	for (const files of entries) {
		for (const { items, noun = ITEM } of assetFolders(files)) {
			counts.set(noun, (counts.get(noun) ?? 0) + items.length);
		}
	}
	const [lone] = [...counts];
	if (lone === undefined) {
		return `Remove ${it}?`;
	}
	const [noun, count] = lone;
	const what =
		counts.size === 1 && count === 1
			? noun
			: joinWithAnd([...counts].map(([each, n]) => pluralize(n, each)));
	return `Remove ${it} and ${its} ${what}?`;
}

/**
 * An entry removed, with its kind and counts, and, given its files, what it
 * installed under each asset folder, as its question's row named them.
 */
export function removedRow(
	subject: string,
	kind: string,
	files?: readonly string[],
): Row {
	return {
		status: "done",
		subject,
		detail: { label: LOOKS.remove.removed.label, aside: kind },
		...(files === undefined ? {} : { fields: installedFolders(files) }),
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
