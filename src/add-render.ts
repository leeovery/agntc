import { type AssetCounts, skillFolderName } from "./asset-targets.js";
import { heldDetail, type SkillNote, skillHint } from "./choose-items.js";
import type { Clearance } from "./clear-conflicts.js";
import { folderName } from "./discover.js";
import { type InstallItem, itemPath, pathLabel } from "./install-item.js";
import { homeShortened } from "./scope.js";
import {
	formatPackCounts,
	formatRefLabel,
	type ItemOutcome,
	joinWithAnd,
	pluralize,
} from "./summary.js";
import { LOOKS } from "./terminal/tally.js";
import type {
	BlockSubject,
	Child,
	Row,
	RowHead,
	Status,
} from "./terminal/types.js";
import type { AddTally, Choice } from "./ui.js";

/** The version a source was read at, as its row shows it. */
export interface SourceVersion {
	ref: string | null;
	commit: string | null;
	constraint?: string;
}

/** The source's row head: what it's named by, then its ref and any constraint, dim. */
export function sourceHead(
	subject: string,
	{ ref, commit, constraint }: SourceVersion,
): RowHead {
	const meta = [formatRefLabel(ref, commit), constraint ?? ""]
		.filter((part) => part !== "")
		.join(" ");
	return { subject, meta };
}

/** An item as add's rows name it: its folder's name, and dim beside it the path telling it apart. */
export type ItemName = Pick<Child, "name" | "aside">;

/** How add's rows name the item at a path in the source. */
export type ItemNames = (path: string) => ItemName;

/**
 * Names each item by its folder's name, as `update` and `list` do. Where
 * items at two of `paths` share a name, each carries its path as an aside,
 * unless the path is the name itself.
 */
export function itemNames(
	paths: readonly string[],
	rootName: string,
): ItemNames {
	const seen = new Map<string, Set<string>>();
	for (const path of paths) {
		const name = folderName(path, rootName);
		seen.set(name, (seen.get(name) ?? new Set()).add(path));
	}
	return (path) => {
		const name = folderName(path, rootName);
		const aside = pathLabel(path, rootName);
		return (seen.get(name)?.size ?? 0) > 1 && aside !== name
			? { name, aside }
			: { name };
	};
}

/** A pack's kind and what it installs, as its menu option and its installed row say it. */
export function packKind(counts: AssetCounts): string {
	return `pack · ${formatPackCounts(counts)}`;
}

/**
 * An item as the menu and `--list` offer it: by name, then a pack's kind and
 * what it installs, `counts` ({@link packKind}), or a skill's description.
 */
export function itemChoice(
	item: InstallItem,
	names: ItemNames,
	counts: AssetCounts,
): Choice<InstallItem> {
	const { name, aside } = names(itemPath(item));
	const hint = item.kind === "pack" ? packKind(counts) : skillHint(item.skill);
	return {
		value: item,
		label: name,
		...(aside === undefined ? {} : { aside }),
		...(hint ? { hint } : {}),
	};
}

/** What a source offers, counted as `add` counts it: `3 packs · 2 skills`, none left out at 0. */
export function holdings(items: readonly InstallItem[]): string {
	const packs = items.filter((item) => item.kind === "pack").length;
	const counts = (
		[
			[packs, "pack"],
			[items.length - packs, "skill"],
		] as const
	)
		.filter(([count]) => count > 0)
		.map(([count, noun]) => pluralize(count, noun));
	return counts.length === 0 ? "no skills or packs" : counts.join(" · ");
}

/** What the source's row says after a menu: how many of the items it offered installed. */
export function pickedDetail(
	outcomes: readonly ItemOutcome[],
	offered: number,
): string {
	const installed = outcomes.filter(
		({ status }) => status === "installed",
	).length;
	return `${installed} of ${offered} installed`;
}

/**
 * What a block measures the source's row from: its head, the items at
 * `paths` it may hang beneath it, and every skill left out it may tell of,
 * as asked and as told, each named by `names`. A left-out skill carries its
 * glyph, and so do items where there's more than one, as items that end
 * differently do.
 */
export function sourceSubject(
	head: RowHead,
	paths: readonly string[],
	notes: readonly SkillNote[],
	names: ItemNames,
): BlockSubject {
	const items = [...new Set(paths)].map(names);
	const status: Status | undefined = items.length > 1 ? "done" : undefined;
	const told = new Map(
		[
			...leftOut(notes).map((note) => noteChild(note, names)),
			...askedNotes(notes, names),
		].map(({ name, aside }) => [
			`${name} ${aside ?? ""}`,
			{ name, ...(aside === undefined ? {} : { aside }) },
		]),
	);
	return {
		...head,
		children: [
			...items.map((item) => ({ ...item, ...(status ? { status } : {}) })),
			...[...told.values()].map((each) => ({
				...each,
				status: "note" as const,
			})),
		],
	};
}

/**
 * The source as its menu asks about it: what it holds, and the skills left
 * off the menu, those one installed pack holds counted as one line, as the
 * row shares the screen with the question.
 */
export function askedRow(
	head: RowHead,
	held: string,
	notes: readonly SkillNote[],
	names: ItemNames,
): Row {
	return {
		status: "done",
		...head,
		detail: held,
		...withChildren(askedNotes(notes, names)),
	};
}

/**
 * The source as a run that stopped leaves it, with every skill the choice
 * left out: unchanged, or failed when the stop came once files may be on disk.
 */
export function stoppedRow(
	head: RowHead,
	held: string,
	notes: readonly SkillNote[],
	names: ItemNames,
	status: "unchanged" | "failed",
): Row {
	return {
		status,
		...head,
		detail: held,
		...withChildren(leftOut(notes).map((note) => noteChild(note, names))),
	};
}

/**
 * The skills the choice left out, as an installed pack holds them: what a row
 * tells of its own. A skill taken from its pack is told under the item, once
 * it installed.
 */
function leftOut(notes: readonly SkillNote[]): SkillNote[] {
	return notes.filter(({ heldBy }) => heldBy !== undefined);
}

/** `--list`: the source and everything it offers, as its menu would offer it ({@link itemChoice}). */
export function listedRow(
	head: RowHead,
	held: string,
	choices: readonly Choice<InstallItem>[],
): Row {
	return {
		status: "done",
		...head,
		detail: held,
		...withChildren(
			choices.map(({ label, aside, hint }) => ({
				name: label,
				...(aside === undefined ? {} : { aside }),
				...(hint === undefined ? {} : { detail: hint }),
			})),
		),
	};
}

/**
 * What `add` did with the source: each item's outcome beneath it, named by
 * `names`, a skill taken from its pack and installed with its note under its
 * kind, then the skills left out. Glyph by its worst outcome, or nothing to
 * do when there's none. Outcomes that ended alike carry no glyph of their
 * own; a note always carries its own. A local entry cleared out of an item's
 * way is named as its row named it, shortened against `home`.
 */
export function addedRow(
	head: RowHead,
	detail: string,
	outcomes: readonly ItemOutcome[],
	notes: readonly SkillNote[],
	names: ItemNames,
	home: string,
): Row {
	const statuses = outcomes.map(outcomeStatus);
	const alike = new Set(statuses).size <= 1;
	return {
		status: worstOf(statuses),
		...head,
		detail,
		...withChildren([
			...outcomes.map((outcome, index) => ({
				...names(outcome.path),
				detail: outcomeLines(outcome, notes, home).join("\n"),
				...(alike ? {} : { status: statuses[index] }),
			})),
			...leftOut(notes).map((note) => noteChild(note, names)),
		]),
	};
}

function withChildren(children: Child[]): Pick<Row, "children"> {
	return children.length === 0 ? {} : { children };
}

function noteChild({ path, detail }: SkillNote, names: ItemNames): Child {
	return { ...names(path), detail, status: "note" };
}

/**
 * The skills left out as a question's row tells them: those one installed
 * pack holds as one line counting them, a lone one by name.
 */
function askedNotes(notes: readonly SkillNote[], names: ItemNames): Child[] {
	const byPack = new Map<string, SkillNote[]>();
	for (const note of leftOut(notes)) {
		const pack = note.heldBy ?? "";
		byPack.set(pack, [...(byPack.get(pack) ?? []), note]);
	}
	return [...byPack].map(([pack, packed]) =>
		packed.length === 1 && packed[0] !== undefined
			? noteChild(packed[0], names)
			: {
					name: pluralize(packed.length, "skill"),
					detail: heldDetail(pack),
					status: "note" as const,
				},
	);
}

/**
 * Its kind and counts, or why it didn't install, then what was cleared out
 * of its way, a line each; an installed skill taken from its pack with that
 * pack's note under its kind.
 */
function outcomeLines(
	outcome: ItemOutcome,
	notes: readonly SkillNote[],
	home: string,
): string[] {
	return [
		...resultLines(outcome, notes),
		...(outcome.cleared ?? []).map((each) => clearedWords(each, home)),
	];
}

function resultLines(
	outcome: ItemOutcome,
	notes: readonly SkillNote[],
): string[] {
	if (outcome.status !== "installed") {
		return [outcome.message?.detail ?? outcome.reason];
	}
	const taken = notes.find(
		(note) => note.heldBy === undefined && note.path === outcome.path,
	);
	const kind =
		outcome.kind === "pack" ? packKind(outcome.assetCounts) : "skill";
	return taken === undefined ? [kind] : [kind, taken.detail];
}

/**
 * What went out of an item's way, and its files ({@link namedFiles}):
 * another entry, removed, named as the question's row named it, or files
 * agntc didn't install, replaced.
 */
export function clearedWords(clearance: Clearance, home: string): string {
	const files = namedFiles(clearance.files);
	return clearance.kind === "entry"
		? `removed ${homeShortened(clearance.key, home)}, whose files were in the way: ${files}`
		: `replaced files agntc didn't install: ${files}`;
}

/** How many files a cleared line names before counting the rest. */
const NAMED_FILES = 3;

/**
 * Paths by name, once each: a skill folder's by its folder, any other by its
 * last segment; past a few, how many more.
 */
function namedFiles(paths: readonly string[]): string {
	const names = [...new Set(paths.map(fileName))];
	return names.length <= NAMED_FILES
		? joinWithAnd(names)
		: `${names.slice(0, NAMED_FILES).join(", ")} and ${names.length - NAMED_FILES} more`;
}

function fileName(path: string): string {
	return (
		skillFolderName(path) ??
		path
			.split("/")
			.filter((segment) => segment !== "")
			.at(-1) ??
		path
	);
}

export function outcomeStatus({ status }: ItemOutcome): Status {
	return LOOKS.add[status].status;
}

const SEVERITY: Status[] = ["failed", "attention", "done"];

/** Failed, then needing a look, then done; with no outcome, nothing to do. */
function worstOf(statuses: readonly Status[]): Status {
	return SEVERITY.find((status) => statuses.includes(status)) ?? "unchanged";
}

/** The run's outcomes counted by add's tally categories. */
export function addTally(outcomes: readonly ItemOutcome[]): AddTally {
	const counts: AddTally = {};
	for (const { status } of outcomes) {
		counts[status] = (counts[status] ?? 0) + 1;
	}
	return counts;
}
