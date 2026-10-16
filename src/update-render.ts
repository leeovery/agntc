import { gitErrorCause } from "./errors.js";
import type { Advice, SubjectMessage } from "./message.js";
import { memberName, repoFromKey } from "./source-parser.js";
import { formatPackCounts, pluralize, upgradeAdvice } from "./summary.js";
import { LOOKS, type Look } from "./terminal/tally.js";
import type {
	BlockSubject,
	Child,
	Detail,
	NextItem,
	Row,
	Status,
} from "./terminal/types.js";
import type { UpdateTally } from "./ui.js";
import {
	type EntryGroup,
	isSuccessOutcome,
	type PluginOutcome,
} from "./update-groups.js";
import type { VersionMove } from "./version-resolve.js";

/**
 * The `owner/repo` a group installs from, taken from its first member key.
 * Every member of a group shares one repo, and a member key is `owner/repo`
 * for a standalone or `owner/repo/<member>` for an entry from a multi-item repo — the
 * first two segments are the repo either way, so the member suffix is stripped.
 */
export function repoOf(group: EntryGroup): string {
	return repoFromKey(group.members[0]!.key);
}

/**
 * The single human label a group's repo shows across every surface — its
 * row, its Next items and its block subject — so all of them name it alike.
 *
 * Almost always a repo has one group in a run, so the label is the bare
 * `owner/repo`. When one repo yields MULTIPLE groups (members added at different
 * intents), a bare label would merge two distinct groups' version info into one
 * indistinguishable line — a correctness bug — so each group disambiguates by
 * appending its intent: `@^1.2.3` (constrained caret), `@v2.0.0` / `@main`
 * (unconstrained exact-pin / branch), or the `@HEAD` sentinel for a HEAD-tracked
 * (`versionIntent === null`) group. Because `versionIntent = constraint ?? ref`,
 * the one suffix rule covers every case with no branch on `group.constrained`.
 */
export function groupLabel(group: EntryGroup, groups: EntryGroup[]): string {
	const base = repoOf(group);
	if (groups.filter((g) => repoOf(g) === base).length === 1) {
		return base;
	}
	const suffix = group.versionIntent === null ? "HEAD" : group.versionIntent;
	return `${base}@${suffix}`;
}

/** A row's subject and its dim meta: a repo and the intent it tracks, or a local entry's folder. */
export interface RowHead {
	subject: string;
	meta: string;
}

/** The intent a group or entry tracks: its constraint, else its ref, else HEAD. */
export function intentMeta(intent: string | null): string {
	return intent ?? "HEAD";
}

const CATEGORY: Record<PluginOutcome["status"], keyof UpdateTally> = {
	updated: "updated",
	absorbed: "updated",
	refreshed: "refreshed",
	"up-to-date": "upToDate",
	"newer-tags": "upToDate",
	"check-failed": "notChecked",
	"constrained-no-match": "notChecked",
	aborted: "notUpdated",
	blocked: "notUpdated",
	"copy-failed": "failed",
	failed: "failed",
	"gone-removed": "removed",
	"gone-kept": "kept",
};

/** How an outcome reads: as the tally category that counts it. */
function lookOf(status: PluginOutcome["status"]): Look {
	return LOOKS.update[CATEGORY[status]];
}

export function outcomeStatus(outcome: PluginOutcome): Status {
	return lookOf(outcome.status).status;
}

/** The run's outcomes counted by update's tally categories. */
export function updateTally(outcomes: readonly PluginOutcome[]): UpdateTally {
	const counts: UpdateTally = {};
	for (const { status } of outcomes) {
		const category = CATEGORY[status];
		counts[category] = (counts[category] ?? 0) + 1;
	}
	return counts;
}

const SEVERITY: Status[] = ["failed", "attention", "done", "unchanged"];

/** The outcome that reads worst: failed, then needing a look, then done, then up to date. */
function worstOf(outcomes: readonly PluginOutcome[]): PluginOutcome {
	const rank = (outcome: PluginOutcome) =>
		SEVERITY.indexOf(outcomeStatus(outcome));
	return outcomes.reduce((worst, outcome) =>
		rank(outcome) < rank(worst) ? outcome : worst,
	);
}

/** What a block measures a group's row from: its head, and its members, each given a glyph's room. */
export function groupSubject(
	head: RowHead,
	keys: readonly string[],
): BlockSubject {
	return {
		...head,
		children: keys.map((key) => ({ name: memberName(key), status: "done" })),
	};
}

/** `v0.2.4 → v0.2.5`, as a child's detail words a move. */
function moveWords({ from, to }: VersionMove): string {
	return `${from} → ${to}`;
}

/**
 * Where a group's members moved: from one version they shared, or each from
 * their own (`to` alone), when the row can't carry a shared start.
 */
export type GroupMove = { move: VersionMove } | { to: string };

/** One member's outcome, with its own move when the group's members started apart. */
export interface MemberResult {
	outcome: PluginOutcome;
	move?: VersionMove;
	/** How many files the reinstall copied, for a single key's row. */
	files?: number;
}

/**
 * A group the run reinstalled, or one key's entry: glyph by its worst member,
 * its move, with how it ended when no member landed, and its members as
 * children. Members that ended alike carry no glyph of their own.
 */
export function reinstalledRow(
	head: RowHead,
	move: GroupMove,
	members: readonly MemberResult[],
): Row {
	const outcomes = members.map(({ outcome }) => outcome);
	const worst = worstOf(outcomes);
	const alike = new Set(outcomes.map(outcomeStatus)).size === 1;
	return {
		status: outcomeStatus(worst),
		...head,
		detail: groupDetail(move, outcomes.some(isSuccessOutcome), worst),
		children: members.map((member) => memberChild(member, alike)),
	};
}

function groupDetail(
	move: GroupMove,
	landed: boolean,
	worst: PluginOutcome,
): Detail {
	const ended = lookOf(worst.status).label;
	if ("move" in move) {
		return landed ? { move: move.move } : { move: move.move, note: ended };
	}
	return { label: landed ? `updated to ${move.to}` : ended };
}

function memberChild(
	{ outcome, move, files }: MemberResult,
	alike: boolean,
): Child {
	return {
		name: memberName(outcome.key),
		...(alike ? {} : { status: outcomeStatus(outcome) }),
		detail: isSuccessOutcome(outcome)
			? reinstalledDetail(outcome, move, files)
			: outcomeDetail(outcome),
	};
}

type Reinstalled = Extract<PluginOutcome, { status: "updated" | "refreshed" }>;

/** Its own move when it has one, its kind and counts, the files copied, and the key it moved to. */
function reinstalledDetail(
	outcome: Reinstalled,
	move: VersionMove | undefined,
	files: number | undefined,
): string {
	const moved = outcome.previousKey !== undefined;
	return [
		move === undefined ? "" : moveWords(move),
		kindAndCounts(outcome),
		files === undefined ? "" : pluralize(files, "file"),
		moved ? `now keyed ${outcome.key}` : "",
	]
		.filter((part) => part !== "")
		.join(" · ");
}

/** `skill`, or a pack's counts as `add` words them: `pack · 2 skills, 1 folder`. */
function kindAndCounts({ newEntry, assetCounts }: Reinstalled): string {
	return newEntry.type === "pack"
		? `pack · ${formatPackCounts(assetCounts ?? {})}`
		: "skill";
}

/** What an outcome that didn't reinstall says of its entry: its message, else how it reads. */
function outcomeDetail(outcome: PluginOutcome): string {
	if (isSuccessOutcome(outcome) || !("summary" in outcome)) {
		return lookOf(outcome.status).label;
	}
	return outcome.message?.detail ?? outcome.summary;
}

/** A local entry: its own row, how it ended in its detail. */
export function localRow(head: RowHead, member: MemberResult): Row {
	const { outcome } = member;
	return {
		status: outcomeStatus(outcome),
		...head,
		detail: isSuccessOutcome(outcome)
			? {
					label: lookOf(outcome.status).label,
					aside: reinstalledDetail(outcome, undefined, member.files),
				}
			: outcomeDetail(outcome),
	};
}

/** A group whose clone failed: the failure, and every member it took down. */
export function cloneFailedRow(
	head: RowHead,
	reason: string,
	keys: readonly string[],
): Row {
	return {
		status: "failed",
		...head,
		detail: { label: "clone failed", aside: reason },
		children: keys.map((key) => ({ name: memberName(key) })),
	};
}

/** Why a group or key was left as it is. */
export type LeftAlone =
	| { status: "up-to-date" | "newer-tags" }
	| { status: "check-failed"; reason: string }
	| { status: "constrained-no-match"; constraint: string };

/** A group or key the run left as it is, and why. */
export function leftAloneRow(head: RowHead, why: LeftAlone): Row {
	return {
		status: lookOf(why.status).status,
		...head,
		detail: leftAloneDetail(why),
	};
}

function leftAloneDetail(why: LeftAlone): Detail {
	switch (why.status) {
		case "up-to-date":
			return "up to date";
		case "newer-tags":
			return "newer tags available";
		case "check-failed":
			return { label: "not checked", aside: gitErrorCause(why.reason) };
		case "constrained-no-match":
			return { label: `no tags satisfy ${why.constraint}` };
	}
}

/** The remedy a message carries, under its subject: the row already says what happened. */
export function remedyItem(message: SubjectMessage): NextItem | null {
	return message.remedy === undefined
		? null
		: { subject: message.subject, remedy: message.remedy };
}

/** A message whose row says less than it does: what it says leads its remedy. */
export function adviceItem(message: Advice): NextItem {
	const { lead, steps } = message.remedy;
	return {
		subject: message.subject,
		remedy: { lead: `${message.detail} ${lead}`, steps },
	};
}

/**
 * An exact-pinned group with newer tags: the pin, the newest tag, and the
 * re-add commands that pin the group's members to it. `label` is the
 * {@link groupLabel}; `pinnedRef` the group's version intent.
 */
export function newerTagsMessage(
	label: string,
	pinnedRef: string,
	newestTag: string,
	commands: string[],
): Advice {
	const detail = `Pinned to ${pinnedRef} — newer tags available (latest: ${newestTag}).`;
	const text = `${label}: ${detail}`;
	const advice = upgradeAdvice(commands);
	return {
		subject: label,
		detail,
		text,
		remedy: advice.remedy,
		plain: `${text} ${advice.plain}`,
	};
}

/**
 * One pinned key with newer tags: the pin, every newer tag newest first, and
 * the re-add that pins it to the newest.
 */
export function pinnedTagsMessage(
	key: string,
	pinnedRef: string,
	tags: readonly string[],
	command: string,
): Advice {
	const newestFirst = [...tags].reverse();
	const pinned = `Pinned to ${pinnedRef}.`;
	const detail = `${pinned} Newer tags available: ${newestFirst.join(", ")}.`;
	const advice = upgradeAdvice([command]);
	return {
		subject: key,
		detail,
		text: detail,
		remedy: advice.remedy,
		plain: [
			`${pinned} Newer tags available:`,
			...newestFirst.map((tag) => `  ${tag}`),
			advice.plain,
		].join("\n"),
	};
}
