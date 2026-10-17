import { heldDetail, type MenuOption, type SkillNote } from "./choose-items.js";
import type { InstallItem } from "./install-item.js";
import {
	formatPackCounts,
	formatRefLabel,
	type ItemOutcome,
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
import type { AddTally } from "./ui.js";

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
 * What a block measures the source's row from: its head, the items it may
 * hang beneath it, and every skill left out it may tell of, as asked and as
 * told. A left-out skill carries its glyph, and so do items where there's
 * more than one, as items that end differently do.
 */
export function sourceSubject(
	head: RowHead,
	items: readonly string[],
	notes: readonly SkillNote[],
): BlockSubject {
	const itemNames = [...new Set(items)];
	const status: Status | undefined = itemNames.length > 1 ? "done" : undefined;
	const noteNames = new Set([
		...leftOut(notes).map(({ subject }) => subject),
		...askedNotes(notes).map(({ name }) => name),
	]);
	return {
		...head,
		children: [
			...itemNames.map((name) => ({ name, ...(status ? { status } : {}) })),
			...[...noteNames].map((name) => ({ name, status: "note" as const })),
		],
	};
}

/**
 * The source as its menu asks about it: what it holds, and the skills left
 * off the menu, those one installed pack holds counted as one line, as the
 * row shares the screen with the question.
 */
export function sourceRow(
	head: RowHead,
	held: string,
	notes: readonly SkillNote[],
): Row {
	return {
		status: "done",
		...head,
		detail: held,
		...withChildren(askedNotes(notes)),
	};
}

/** The source as a run that installed nothing leaves it, with every skill the choice left out. */
export function notedRow(
	head: RowHead,
	held: string,
	notes: readonly SkillNote[],
): Row {
	return {
		status: "unchanged",
		...head,
		detail: held,
		...withChildren(leftOut(notes).map(noteChild)),
	};
}

/**
 * The skills the choice left out, as an installed pack holds them: what a row
 * tells of its own. A skill taken from its pack is told under the item, once
 * it installed.
 */
export function leftOut(notes: readonly SkillNote[]): SkillNote[] {
	return notes.filter(({ heldBy }) => heldBy !== undefined);
}

/** `--list`: the source and everything it offers, each with its kind and counts or its description. */
export function listedRow(
	head: RowHead,
	held: string,
	options: readonly MenuOption[],
): Row {
	return {
		status: "done",
		...head,
		detail: held,
		...withChildren(
			options.map(({ label, hint }) => ({
				name: label,
				...(hint !== undefined ? { detail: hint } : {}),
			})),
		),
	};
}

/**
 * What `add` did with the source: each item's outcome beneath it, a skill
 * taken from its pack and installed with its note under its kind, then the
 * skills left out. Glyph by its worst outcome, or nothing to do when there's
 * none. Outcomes that ended alike carry no glyph of their own; a note always
 * carries its own.
 */
export function addedRow(
	head: RowHead,
	detail: string,
	outcomes: readonly ItemOutcome[],
	notes: readonly SkillNote[],
): Row {
	const statuses = outcomes.map(outcomeStatus);
	const alike = new Set(statuses).size <= 1;
	return {
		status: worstOf(statuses),
		...head,
		detail,
		...withChildren([
			...outcomes.map((outcome, index) => ({
				...outcomeChild(outcome, notes),
				...(alike ? {} : { status: statuses[index] }),
			})),
			...leftOut(notes).map(noteChild),
		]),
	};
}

function withChildren(children: Child[]): Pick<Row, "children"> {
	return children.length === 0 ? {} : { children };
}

function noteChild({ subject, detail }: SkillNote): Child {
	return { name: subject, detail, status: "note" };
}

/**
 * The skills left out as a question's row tells them: those one installed
 * pack holds as one line counting them, a lone one by name.
 */
function askedNotes(notes: readonly SkillNote[]): Child[] {
	const byPack = new Map<string, SkillNote[]>();
	for (const note of leftOut(notes)) {
		const pack = note.heldBy ?? "";
		byPack.set(pack, [...(byPack.get(pack) ?? []), note]);
	}
	return [...byPack].map(([pack, packed]) =>
		packed.length === 1 && packed[0] !== undefined
			? noteChild(packed[0])
			: {
					name: pluralize(packed.length, "skill"),
					detail: heldDetail(pack),
					status: "note" as const,
				},
	);
}

/** Its kind and counts, or why it didn't install; an installed skill taken from its pack with that pack's note. */
function outcomeChild(
	outcome: ItemOutcome,
	notes: readonly SkillNote[],
): Child {
	if (outcome.status !== "installed") {
		return {
			name: outcome.label,
			detail: outcome.message?.detail ?? outcome.reason,
		};
	}
	const taken = notes.find(
		(note) => note.heldBy === undefined && note.path === outcome.path,
	);
	const kind =
		outcome.kind === "pack"
			? `pack · ${formatPackCounts(outcome.assetCounts)}`
			: "skill";
	return {
		name: outcome.label,
		detail: taken === undefined ? kind : `${kind}\n${taken.detail}`,
	};
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
