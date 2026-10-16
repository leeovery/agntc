import type { MenuOption, SkillNote } from "./choose-items.js";
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

/**
 * What a block measures the source's row from: its head, and every name it
 * may hang beneath it. Where there's more than one, each is given a glyph's
 * room, as children that end differently carry one.
 */
export function sourceSubject(
	head: RowHead,
	names: readonly string[],
): BlockSubject {
	const distinct = [...new Set(names)];
	const status = distinct.length > 1 ? "done" : undefined;
	return {
		...head,
		children: distinct.map((name) => ({ name, ...(status ? { status } : {}) })),
	};
}

/** The source as its menu asks about it: what it holds, and the skills left off the menu, with why. */
export function sourceRow(
	head: RowHead,
	held: string,
	leftOut: readonly SkillNote[],
): Row {
	return {
		status: "done",
		...head,
		detail: held,
		...withChildren(leftOut.map(noteChild)),
	};
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
 * taken from its pack with its note under its kind, then the skills left
 * out. Glyph by its worst outcome, or nothing to do when there's none.
 * Children that ended alike carry no glyph of their own.
 */
export function addedRow(
	head: RowHead,
	held: string,
	outcomes: readonly ItemOutcome[],
	notes: readonly SkillNote[],
): Row {
	const told: { status: Status; child: Child }[] = [
		...outcomes.map((outcome) => ({
			status: outcomeStatus(outcome),
			child: outcomeChild(outcome, notes),
		})),
		...notes
			.filter(({ leftOut }) => leftOut)
			.map((note) => ({ status: "note" as const, child: noteChild(note) })),
	];
	const alike = new Set(told.map(({ status }) => status)).size <= 1;
	return {
		status: worstOf(outcomes.map(outcomeStatus)),
		...head,
		detail: held,
		...withChildren(
			told.map(({ status, child }) => (alike ? child : { ...child, status })),
		),
	};
}

function withChildren(children: Child[]): Pick<Row, "children"> {
	return children.length === 0 ? {} : { children };
}

function noteChild({ subject, detail }: SkillNote): Child {
	return { name: subject, detail };
}

/** Its kind and counts, or why it didn't install, and the note a skill taken from its pack carries. */
function outcomeChild(
	outcome: ItemOutcome,
	notes: readonly SkillNote[],
): Child {
	const taken = notes.find(
		({ leftOut, path }) => !leftOut && path === outcome.path,
	);
	return {
		name: outcome.label,
		detail: [outcomeDetail(outcome), taken?.detail ?? ""]
			.filter((line) => line !== "")
			.join("\n"),
	};
}

function outcomeDetail(outcome: ItemOutcome): string {
	if (outcome.status !== "installed") {
		return outcome.message?.text ?? outcome.reason;
	}
	return outcome.kind === "pack"
		? `pack · ${formatPackCounts(outcome.assetCounts)}`
		: "skill";
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
