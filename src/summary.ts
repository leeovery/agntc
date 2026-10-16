import type { AssetCounts } from "./asset-targets.js";
import type { Advice, Remedy, RichMessage } from "./message.js";
import { formatVersionMove } from "./version-resolve.js";

export function pluralize(count: number, singular: string): string {
	return count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinWithAnd(items: string[]): string {
	if (items.length <= 1) {
		return items.join("");
	}
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function formatRefLabel(
	ref: string | null,
	commit: string | null,
): string {
	if (ref !== null) return ref;
	if (commit === null) return "local";
	return "HEAD";
}

/** One line naming the non-zero asset counts, e.g. `2 skills, 1 agent`. */
export function formatAssetCounts(counts: AssetCounts): string {
	return Object.entries(counts)
		.filter(([, count]) => count > 0)
		.map(([type, count]) => pluralize(count, type.replace(/s$/, "")))
		.join(", ");
}

/** A pack's counts, skills always first: `2 skills, 3 folders, 1 agent`. */
export function formatPackCounts({
	skills = 0,
	...assets
}: AssetCounts): string {
	return [pluralize(skills, "skill"), formatAssetCounts(assets)]
		.filter((part) => part !== "")
		.join(", ");
}

/** Which item an add outcome is about. */
export interface ItemIdentity {
	label: string;
	key: string;
	kind: "skill" | "pack";
	path: string;
}

/**
 * What became of one item `add` set out to install. A skipped item carrying
 * `flags` was stopped for want of them, with no terminal to ask.
 */
export type ItemOutcome = ItemIdentity &
	(
		| { status: "installed"; assetCounts: AssetCounts; files: string[] }
		| { status: "skipped" | "failed"; reason: string; flags?: string[] }
	);

interface AddSummaryInput {
	sourceKey: string;
	ref: string | null;
	commit: string | null;
	outcomes: ItemOutcome[];
}

/**
 * An add summary: one line per item, grouped by how it ended, plus the
 * `headline` for the closing outro.
 */
export interface AddSummary {
	headline: string;
	installed: string[];
	skipped: string[];
	failed: string[];
}

export function renderAddSummary(input: AddSummaryInput): AddSummary {
	const summary: AddSummary = {
		headline: "",
		installed: [],
		skipped: [],
		failed: [],
	};
	for (const outcome of input.outcomes) {
		if (outcome.status === "installed") {
			summary.installed.push(installedLine(outcome));
		} else {
			summary[outcome.status].push(
				`${outcome.label}: ${outcome.status} — ${outcome.reason}`,
			);
		}
	}
	summary.headline =
		summary.installed.length > 0
			? `Installed ${input.sourceKey}@${formatRefLabel(input.ref, input.commit)}`
			: `Nothing installed from ${input.sourceKey}`;
	return summary;
}

function installedLine(
	outcome: Extract<ItemOutcome, { status: "installed" }>,
): string {
	if (outcome.kind === "skill") {
		return outcome.label;
	}
	return `${outcome.label} (pack · ${formatPackCounts(outcome.assetCounts)})`;
}

type UpdateOutcomeInput =
	| {
			type: "git-update";
			key: string;
			oldRef: string | null;
			newRef: string | null;
			oldCommit: string | null;
			newCommit: string;
	  }
	| {
			type: "local-update";
			key: string;
	  };

export function renderUpdateOutcomeSummary(input: UpdateOutcomeInput): string {
	if (input.type === "git-update") {
		const move = formatVersionMove({
			oldRef: input.oldRef,
			newRef: input.newRef,
			oldCommit: input.oldCommit,
			newCommit: input.newCommit,
		});
		return `${input.key}: Updated ${move}`;
	}

	return `${input.key}: Refreshed from local path`;
}

interface RemoveSummaryInput {
	summaryLabel: string;
	fileCount: number;
}

export function renderRemoveSummary(input: RemoveSummaryInput): string {
	return `Removed ${input.summaryLabel} — ${input.fileCount} file(s)`;
}

export interface OutOfConstraintInfo {
	/**
	 * What the item is about: the group label in all-mode, so an N-member
	 * group collapses to ONE item and two distinct-intent groups of one repo
	 * keep their own @intent-disambiguated ones; the key for a single key.
	 */
	subject: string;
	/**
	 * The POST-BUMP current version — the tag this run actually landed on (the
	 * resolved best-within-constraint tag), NOT the pre-bump `entry.ref`. Naming
	 * the pre-bump ref would report a stale current, contradicting the row's
	 * move for a same-run safe bump.
	 */
	current: string;
	latestOverall: string;
	/**
	 * The re-add command of each entry the item covers, without a version: a
	 * bare add re-resolves the latest semver tag and re-establishes caret at the
	 * new major, so it jumps the boundary.
	 */
	commands: string[];
}

/** A newer version outside the constraint, and the commands that move to it. */
export function outOfConstraintMessage(info: OutOfConstraintInfo): Advice {
	const { subject, current, latestOverall } = info;
	const available = `${current} -> ${latestOverall} available.`;
	const advice = upgradeAdvice(info.commands);
	return {
		subject,
		detail: `Newer version outside the constraint: ${available}`,
		text: `${subject}  ${available}`,
		remedy: advice.remedy,
		plain: `${subject}  ${available} ${advice.plain}`,
	};
}

/**
 * `To upgrade:` and the commands, once each. Its sentence runs one command
 * on after the lead, and sets several a line each.
 */
export function upgradeAdvice(
	commands: string[],
): RichMessage & { remedy: Remedy } {
	const distinct = [...new Set(commands)];
	const lead = "To upgrade:";
	return {
		text: "",
		remedy: { lead, steps: distinct.map((command) => ({ command })) },
		plain:
			distinct.length === 1
				? `${lead} ${distinct[0]}`
				: [lead, ...distinct.map((command) => `    ${command}`)].join("\n"),
	};
}
