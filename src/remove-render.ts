import type { EntryAssets } from "./entry-assets.js";
import type { ManifestEntry } from "./manifest.js";
import {
	type AssetCount,
	countedAssets,
	joinWithAnd,
	pluralize,
} from "./summary.js";
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

/** What a question counts a recorded path under no asset type as. */
const OTHER = "other item";

/** The order a row words its counts in. */
const NOUN_ORDER = ["skill", "folder", "agent", "hook", OTHER];

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
 * The question asked under the rows of `entries`: whether to remove them and
 * what they install, counted and worded as their rows word it and added up
 * across them, those counting none left out. `Remove it and its 2 skills, 1
 * folder and 1 agent?`, `Remove them and their 14 skills?`; a lone one by
 * its noun alone, `Remove it and its skill?`; nothing recorded, `Remove
 * it?`. A skill entry counts as the one skill its row names, whatever its
 * paths; a pack's paths under no asset type, which its row counts as
 * `other`, are other items.
 */
export function removalQuestion(entries: readonly RemovedAssets[]): string {
	const [it, its] = entries.length === 1 ? ["it", "its"] : ["them", "their"];
	const counts = totals(entries);
	const [lone] = counts;
	if (lone === undefined) {
		return `Remove ${it}?`;
	}
	const what =
		counts.length === 1 && lone.count === 1
			? lone.noun
			: joinWithAnd(counts.map(({ count, noun }) => pluralize(count, noun)));
	return `Remove ${it} and ${its} ${what}?`;
}

/** An entry and what it installs, as its removal's question counts it. */
export interface RemovedAssets {
	entry: ManifestEntry;
	assets: EntryAssets;
}

/** What each entry's row counts, added up by noun, in the order rows word them. */
function totals(entries: readonly RemovedAssets[]): AssetCount[] {
	const totals = new Map<string, number>();
	for (const { count, noun } of entries.flatMap(rowCounts)) {
		totals.set(noun, (totals.get(noun) ?? 0) + count);
	}
	return [...totals]
		.map(([noun, count]) => ({ noun, count }))
		.sort((a, b) => rank(a.noun) - rank(b.noun));
}

/** Where a noun comes in {@link NOUN_ORDER}; one it doesn't name, after them. */
function rank(noun: string): number {
	const at = NOUN_ORDER.indexOf(noun);
	return at < 0 ? NOUN_ORDER.length : at;
}

function rowCounts({ entry, assets }: RemovedAssets): AssetCount[] {
	if (entry.files.length === 0) {
		return [];
	}
	if ((entry.type ?? "skill") === "skill") {
		return [{ count: 1, noun: "skill" }];
	}
	return [
		...countedAssets(assets.counts),
		...(assets.other > 0 ? [{ count: assets.other, noun: OTHER }] : []),
	];
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
