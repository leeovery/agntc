import type { AssetCounts } from "./asset-targets.js";
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
	const { skills = 0, ...assets } = outcome.assetCounts;
	const counts = [pluralize(skills, "skill"), formatAssetCounts(assets)]
		.filter((part) => part !== "")
		.join(", ");
	return `${outcome.label} (pack · ${counts})`;
}

interface GitUpdateSummaryInput {
	key: string;
	oldRef: string | null;
	newRef: string | null;
	oldCommit: string | null;
	newCommit: string;
	copiedFiles: string[];
}

export function renderGitUpdateSummary(input: GitUpdateSummaryInput): string {
	const move = formatVersionMove({
		oldRef: input.oldRef,
		newRef: input.newRef,
		oldCommit: input.oldCommit,
		newCommit: input.newCommit,
	});
	return `Updated ${input.key}: ${move} — ${input.copiedFiles.length} file(s)`;
}

interface LocalUpdateSummaryInput {
	key: string;
	copiedFiles: string[];
}

export function renderLocalUpdateSummary(
	input: LocalUpdateSummaryInput,
): string {
	return `Refreshed ${input.key} — ${input.copiedFiles.length} file(s)`;
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
	 * The member key — populated ONLY by the single-key path (runSingleUpdate),
	 * which has no group. Rendered via the `label ?? key` fallback so this path
	 * stays byte-identical.
	 */
	key?: string;
	/**
	 * The group label (task 2-1) — populated by the all-mode per-group footer so
	 * an N-member collection collapses to ONE line and two distinct-intent groups
	 * of one repo keep their own @intent-disambiguated lines. Takes precedence over
	 * {@link key} when present.
	 */
	label?: string;
	/**
	 * The POST-BUMP current version — the tag this run actually landed on (the
	 * resolved best-within-constraint tag), NOT the pre-bump `entry.ref`. Naming
	 * the pre-bump ref would report a stale current, contradicting the inline
	 * `Updated <old> -> <tag>` line for a same-run safe bump. Rendered as the left
	 * side of the actionable `<current> -> <latestOverall>` move.
	 */
	current: string;
	latestOverall: string;
	/**
	 * The BARE `owner/repo` for the re-add command — never the @intent label. A
	 * bare `npx agntc add owner/repo` re-resolves the latest semver tag and
	 * re-establishes caret at the new major, so the command jumps the boundary
	 * regardless of the (possibly @intent-disambiguated) line prefix.
	 */
	repo: string;
}

export function renderOutOfConstraintSection(
	infos: OutOfConstraintInfo[],
): string[] {
	if (infos.length === 0) return [];

	// One informative (non-error, exit-0) line per group: the actionable
	// current->newer move plus the BARE re-add directive (the naming spec's
	// canonical `npx agntc add <repo>` command form). The `label ?? key` prefix is
	// unchanged from task 2-7 (all-mode sets label, single-key sets key); the
	// command uses `repo` (bare owner/repo), never the @intent label.
	const lines: string[] = ["Newer versions outside constraints:"];
	for (const info of infos) {
		lines.push(
			`  ${info.label ?? info.key}  ${info.current} -> ${info.latestOverall} available. To upgrade: npx agntc add ${info.repo}`,
		);
	}
	return lines;
}
