import { gitErrorCause } from "./errors.js";
import type { Advice } from "./message.js";
import { memberName, repoFromKey } from "./source-parser.js";
import { formatPackCounts, upgradeAdvice } from "./summary.js";
import { LOOKS, type Look } from "./terminal/tally.js";
import type {
	BlockSubject,
	Child,
	Detail,
	Row,
	RowHead,
	Status,
} from "./terminal/types.js";
import type { UpdateTally } from "./ui.js";
import {
	absorbedBy,
	absorbedOutcome,
	type EntryGroup,
	isSuccessOutcome,
	keyBefore,
	type PluginOutcome,
	takenOverDetail,
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

/**
 * The tally category that counts an outcome. An entry taken over by a pack
 * that then failed to install is a failure too: its files are gone.
 */
function categoryOf(outcome: PluginOutcome): keyof UpdateTally {
	return outcome.status === "absorbed" && !outcome.landed
		? "failed"
		: CATEGORY[outcome.status];
}

/** How an outcome reads: as the tally category that counts it. */
function lookOf(outcome: PluginOutcome): Look {
	return LOOKS.update[categoryOf(outcome)];
}

export function outcomeStatus(outcome: PluginOutcome): Status {
	return lookOf(outcome).status;
}

/** The run's outcomes counted by update's tally categories. */
export function updateTally(outcomes: readonly PluginOutcome[]): UpdateTally {
	const counts: UpdateTally = {};
	for (const outcome of outcomes) {
		const category = categoryOf(outcome);
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
}

/**
 * The members, then each loose entry a pack among them took over, as what
 * became of it, whether it was a member too (skipped, or up to date) or not
 * (in another group, or a local entry of its own): every row a pack settles
 * into says where those went, and says it once.
 */
function withTakenOver(members: readonly MemberResult[]): MemberResult[] {
	const takenBy = new Map(
		members.flatMap(({ outcome: pack }) =>
			absorbedBy(pack).map((key) => [key, pack] as const),
		),
	);
	return [
		...members.filter(({ outcome }) => !takenBy.has(keyBefore(outcome))),
		...[...takenBy].map(([key, pack]) => ({
			outcome: absorbedOutcome(key, pack),
		})),
	];
}

/** Whether every one of the outcomes reads alike, so none needs a glyph of its own. */
function endedAlike(outcomes: readonly PluginOutcome[]): boolean {
	return new Set(outcomes.map(outcomeStatus)).size === 1;
}

/**
 * A group the run reinstalled, or one key's entry: glyph by its worst member,
 * its move, with how it ended when no member landed, and its members as
 * children, the loose entries a pack among them took over included. Members
 * that ended alike carry no glyph of their own.
 */
export function reinstalledRow(
	head: RowHead,
	move: GroupMove,
	members: readonly MemberResult[],
): Row {
	const all = withTakenOver(members);
	const outcomes = all.map(({ outcome }) => outcome);
	const worst = worstOf(outcomes);
	const alike = endedAlike(outcomes);
	return {
		status: outcomeStatus(worst),
		...head,
		detail: groupDetail(move, outcomes, worst),
		children: all.map((member) => memberChild(member, alike)),
	};
}

const GONE: ReadonlySet<PluginOutcome["status"]> = new Set([
	"gone-kept",
	"gone-removed",
]);

/**
 * The group's move, with how it ended when no member landed. A group whose
 * every member is gone upstream made no move, so it says only how it ended.
 */
function groupDetail(
	move: GroupMove,
	outcomes: readonly PluginOutcome[],
	worst: PluginOutcome,
): Detail {
	const ended = lookOf(worst).label;
	if (outcomes.every(({ status }) => GONE.has(status))) {
		return { label: ended };
	}
	const landed = outcomes.some(isSuccessOutcome);
	if ("move" in move) {
		return landed ? { move: move.move } : { move: move.move, note: ended };
	}
	return { label: landed ? `updated to ${move.to}` : ended };
}

function memberChild({ outcome, move }: MemberResult, alike: boolean): Child {
	return {
		name: memberName(keyBefore(outcome)),
		...(alike ? {} : { status: outcomeStatus(outcome) }),
		detail: isSuccessOutcome(outcome)
			? reinstalledDetail(outcome, move)
			: outcomeDetail(outcome),
	};
}

type Reinstalled = Extract<PluginOutcome, { status: "updated" | "refreshed" }>;

/** Its own move when it has one, its kind and counts, and the key it moved to. */
function reinstalledDetail(
	outcome: Reinstalled,
	move: VersionMove | undefined,
): string {
	const moved = outcome.previousKey !== undefined;
	return [
		move === undefined ? "" : moveWords(move),
		kindAndCounts(outcome),
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
		return lookOf(outcome).label;
	}
	return outcome.message?.detail ?? outcome.summary;
}

/**
 * A local entry: its own row, how it ended in its detail, and the loose
 * entries it took over as a pack as its children, each told where it went
 * as its row's pack: the row names the pack. Each ends as the pack did,
 * landed or failed, so none carries a glyph of its own.
 */
export function localRow(head: RowHead, result: MemberResult): Row {
	const { outcome } = result;
	const [, ...taken] = withTakenOver([result]);
	const into = takenOverDetail("this pack", isSuccessOutcome(outcome));
	return {
		status: outcomeStatus(outcome),
		...head,
		detail: isSuccessOutcome(outcome)
			? {
					label: lookOf(outcome).label,
					aside: reinstalledDetail(outcome, undefined),
				}
			: withoutOwnPath(outcomeDetail(outcome), outcome.key),
		...(taken.length > 0
			? {
					children: taken.map(({ outcome: entry }) => ({
						name: memberName(entry.key),
						detail: into,
					})),
				}
			: {}),
	};
}

/** A local entry's reason, without the folder it opens on when that's the entry's own: its row names it. */
function withoutOwnPath(detail: string, key: string): string {
	const own = `${key}: `;
	return detail.startsWith(own) ? detail.slice(own.length) : detail;
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
		detail: { label: "clone failed", aside: cloneFailureCause(reason) },
		children: keys.map((key) => ({ name: memberName(key) })),
	};
}

const CLONE_FAILED = /^git clone failed(?: after \d+ attempts)?: /;

/**
 * A clone failure in one line, as a check failure's row words it: git's
 * cause, without the clone's own preamble or the `done.` its progress ends
 * on. The document keeps the whole message.
 */
function cloneFailureCause(reason: string): string {
	const stderr = reason
		.replace(CLONE_FAILED, "")
		.split("\n")
		.filter((line) => line.trim() !== "done.");
	return gitErrorCause(stderr.join("\n"));
}

/** Why a group or key was left as it is. */
export type LeftAlone =
	| { status: "up-to-date" | "newer-tags" }
	| { status: "check-failed"; reason: string }
	| { status: "constrained-no-match"; constraint: string };

/**
 * A group or key the run left as it is, and why. A key's row names its entry
 * beneath it, `keys`, as its reinstalled row does; a group's names none, its
 * label saying which it is.
 */
export function leftAloneRow(
	head: RowHead,
	why: LeftAlone,
	keys: readonly string[] = [],
): Row {
	return {
		status: LOOKS.update[CATEGORY[why.status]].status,
		...head,
		detail: leftAloneDetail(why),
		...(keys.length > 0
			? { children: keys.map((key) => ({ name: memberName(key) })) }
			: {}),
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
	const latest = `newer tags available (latest: ${newestTag}).`;
	const detail = pinnedDetail(pinnedRef, newestTag);
	const advice = upgradeAdvice(commands);
	return {
		subject: label,
		detail,
		text: `${label}: ${detail}`,
		remedy: advice.remedy,
		plain: `${label}: Pinned to ${pinnedRef} — ${latest} ${advice.plain}`,
	};
}

/**
 * One pinned key with newer tags: the pin and the newest tag, as a group's
 * are worded, then the re-add that pins it to the newest. Machine mode lists
 * every newer tag, newest first.
 */
export function pinnedTagsMessage(
	key: string,
	pinnedRef: string,
	tags: readonly string[],
	command: string,
): Advice {
	const newestFirst = [...tags].reverse();
	const pinned = `Pinned to ${pinnedRef}.`;
	const detail = pinnedDetail(pinnedRef, newestFirst[0] ?? "");
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

/** What a pin with newer tags says at a terminal, a group's and a key's alike. */
function pinnedDetail(pinnedRef: string, newestTag: string): string {
	return `Pinned to ${pinnedRef}, newer tags available (latest: ${newestTag}).`;
}
