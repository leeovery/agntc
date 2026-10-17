import { sourceKeyOf } from "./entry-source.js";
import { gitErrorCause } from "./errors.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { agntcCommand, homeShortened, type ScopeName } from "./scope.js";
import { memberName } from "./source-parser.js";
import { formatRefLabel } from "./summary.js";
import type {
	Detail,
	Field,
	NextItem,
	Row,
	RowHead,
	Status,
	TallyItem,
} from "./terminal/types.js";
import type {
	ChoiceCell,
	ListTally,
	SelectFooter,
	SelectOption,
} from "./ui.js";
import {
	hasOutOfConstraintVersion,
	type UpdateCheckResult,
} from "./update-check.js";
import { checkResultFor } from "./update-check-all.js";
import { isSuccessOutcome, type PluginOutcome } from "./update-groups.js";
import { moveTarget } from "./version-resolve.js";

export const NOTHING_INSTALLED = "No skills or packs installed.";
export const DASHBOARD_QUESTION = "Select a skill or pack to manage";

/** The row an empty manifest leaves. */
export function nothingInstalledRow(): Row {
	return { status: "unchanged", subject: NOTHING_INSTALLED };
}

/** How to install something, for a manifest with nothing in it. */
export function getStartedItem(scope: ScopeName): NextItem {
	return {
		subject: "",
		remedy: {
			lead: "To get started:",
			steps: [{ command: agntcCommand(scope, "add", ["owner/repo"]) }],
		},
	};
}

/** What the dashboard's progress says while it checks every entry. */
export function checkingEntries(count: number): string {
	return `checking ${count === 1 ? "1 entry" : `${count} entries`} for updates…`;
}

/** What the progress says while it checks one entry again. */
export function checkingEntry(key: string, home: string): string {
	return `checking ${homeShortened(key, home)} for updates…`;
}

/**
 * The dashboard's options: each source a heading, a repo by `owner/repo` and
 * a local folder by its path shortened against the home folder, in the order
 * the manifest first names it; under it, its entries in manifest order, each
 * by its path under the source ({@link pathUnder}), its kind, its ref with
 * its constraint, and its status.
 */
export function dashboardOptions(
	manifest: Manifest,
	checks: Map<string, UpdateCheckResult>,
	home: string,
): SelectOption<string>[] {
	const sources = new Map<string, [string, ManifestEntry][]>();
	for (const [key, entry] of Object.entries(manifest)) {
		const source = sourceKeyOf(key, entry);
		sources.set(source, [...(sources.get(source) ?? []), [key, entry]]);
	}
	return [...sources].flatMap(([source, entries]) => [
		{ heading: homeShortened(source, home) },
		...entries.map(([key, entry]) => ({
			value: key,
			label: pathUnder(key, source),
			cells: entryCells(entry, checkResultFor(checks, key)),
		})),
	]);
}

/**
 * An entry by its key's path under its source, so two packs named alike in
 * one repo read apart; one at the source's root by its name.
 */
function pathUnder(key: string, source: string): string {
	return key.startsWith(`${source}/`)
		? key.slice(source.length + 1)
		: memberName(key);
}

/** An entry's kind dim, its ref with its constraint dim, then its status: a narrow line drops the kind, then the ref. */
function entryCells(
	entry: ManifestEntry,
	check: UpdateCheckResult,
): ChoiceCell[] {
	return [
		{ text: entry.type ?? "skill", dim: true, drop: 1 },
		{
			text: formatRefLabel(entry.ref, entry.commit),
			...(entry.constraint === undefined ? {} : { aside: entry.constraint }),
			drop: 2,
		},
		statusCell(entry, check),
	];
}

/** What its check found: a newer version, up to date, needing a look, failed, or local. */
export function statusCell(
	entry: ManifestEntry,
	check: UpdateCheckResult,
): ChoiceCell {
	switch (check.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return { status: "done", text: "up to date", dim: true };
		case "update-available":
			return {
				status: "newer",
				text: moveTarget(entry.ref, check.remoteCommit),
			};
		case "constrained-update-available":
			return { status: "newer", text: check.tag };
		case "newer-tags":
			return { status: "attention", text: "newer tags" };
		case "check-failed":
			return { status: "failed", text: "check failed" };
		case "constrained-no-match":
			return { status: "failed", text: "no matching version" };
		case "local":
			return { status: "local", text: "local", dim: true };
	}
}

/** The dashboard's footer: what its keys do, and how many entries want something. */
export function dashboardFooter(
	checks: Map<string, UpdateCheckResult>,
): SelectFooter {
	const count = (...statuses: UpdateCheckResult["status"][]) =>
		[...checks.values()].filter(({ status }) => statuses.includes(status))
			.length;
	const updates = count("update-available", "constrained-update-available");
	const failed = count("check-failed");
	const counts: TallyItem[] = [
		{
			count: updates,
			label: updates === 1 ? "update" : "updates",
			status: "newer",
		},
		{
			count: count("newer-tags"),
			label: "with newer tags",
			status: "attention",
		},
		{
			count: failed,
			label: failed === 1 ? "check failed" : "checks failed",
			status: "failed",
		},
		{
			count: count("constrained-no-match"),
			label: "with no match",
			status: "failed",
		},
	];
	return { keys: ["⏎ manage", "esc done"], counts };
}

/** What the detail view shows of an entry. */
export interface EntryDetail {
	/** The entry's key as the row names it: a local one shortened against the home folder. */
	subject: string;
	entry: ManifestEntry;
	check: UpdateCheckResult;
	/** What it installs, counted as `add` counts it; empty when it records nothing. */
	assets: string;
}

/**
 * The entry the detail view asks about, its kind beside it, then its
 * version, its constraint with any version outside it, its commit, when it
 * was installed, what it installs, and what its check found.
 */
export function detailRow({ subject, entry, check, assets }: EntryDetail): Row {
	return {
		status: "subject",
		subject,
		detail: entry.type ?? "skill",
		fields: detailFields(entry, check, assets),
	};
}

function detailFields(
	entry: ManifestEntry,
	check: UpdateCheckResult,
	assets: string,
): Field[] {
	const outside = hasOutOfConstraintVersion(check)
		? ` (${check.latestOverall} available outside constraint)`
		: "";
	const status = statusField(entry, check);
	return [
		{ label: "version", value: formatRefLabel(entry.ref, entry.commit) },
		...(entry.constraint === undefined
			? []
			: [{ label: "constraint", value: `${entry.constraint}${outside}` }]),
		{ label: "commit", value: entry.commit?.slice(0, 7) ?? "—" },
		{ label: "installed", value: entry.installedAt.slice(0, 10) },
		...(assets === "" ? [] : [{ label: "installs", value: assets }]),
		...(status === null ? [] : [status]),
	];
}

/** What the entry's check found, in words; a local entry's says nothing its version doesn't. */
function statusField(
	entry: ManifestEntry,
	check: UpdateCheckResult,
): Field | null {
	const field = (value: string, status?: Field["status"]): Field => ({
		label: "status",
		value,
		...(status === undefined ? {} : { status }),
	});
	switch (check.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return field("up to date");
		case "update-available":
			return field(`${moveTarget(entry.ref, check.remoteCommit)} available`);
		case "constrained-update-available":
			return field(`${check.tag} available`);
		case "newer-tags":
			return field("newer tags available");
		case "check-failed":
			return field(
				`couldn't check for updates (${gitErrorCause(check.reason)})`,
				"attention",
			);
		case "constrained-no-match":
			return field(
				`no matching version found for constraint "${entry.constraint}"`,
				"failed",
			);
		case "local":
			return null;
	}
}

/**
 * A version change that went no further than its question: the entry under
 * its repo, as its update's row names it, and why.
 */
export function versionUnchangedRow(
	head: RowHead,
	key: string,
	status: Status,
	detail: Detail,
): Row {
	return { status, ...head, detail, children: [{ name: memberName(key) }] };
}

/** What a list action changed, counted as the session's tally counts it. */
export type ListChange = keyof ListTally;

/** What an action left: the key the entry is recorded under now, and what it changed. */
export interface ListActionResult {
	key: string;
	change: ListChange | null;
}

/**
 * What an update or a version change left once it ended: the key the entry
 * moved to when it reinstalled, counted as what it set out to do; removed
 * when it went as gone upstream; otherwise no change.
 */
export function reinstallResult(
	key: string,
	outcome: PluginOutcome,
	reinstalled: "updated" | "versionChanged",
): ListActionResult {
	if (isSuccessOutcome(outcome)) {
		return { key: outcome.key, change: reinstalled };
	}
	return {
		key,
		change: outcome.status === "gone-removed" ? "removed" : null,
	};
}

/** The session's tally with `change` counted once more. */
export function counted(tally: ListTally, change: ListChange): ListTally {
	return { ...tally, [change]: (tally[change] ?? 0) + 1 };
}
