import type { AssetCounts } from "./copy-plugin-assets.js";
import type { DetectedType } from "./type-detection.js";
import { formatVersionMove } from "./version-resolve.js";

/**
 * A rendered install summary: a one-line `headline` (the terminal `└` outro
 * node) plus zero or more `detail` lines emitted as gutterred `│` log nodes
 * ABOVE it, so the asset/per-member breakdown stays connected to the prompt
 * tree instead of floating below the outro as raw text.
 */
export interface RenderedSummary {
	headline: string;
	detail: string[];
}

function pluralize(count: number, singular: string): string {
	return count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;
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

interface AddSummaryInput {
	manifestKey: string;
	ref: string | null;
	commit: string | null;
	assetCounts: AssetCounts;
}

export function renderAddSummary(input: AddSummaryInput): RenderedSummary {
	const refLabel = formatRefLabel(input.ref, input.commit);
	const counts = formatAssetCounts(input.assetCounts);
	return {
		headline: `Installed ${input.manifestKey}@${refLabel}`,
		detail: counts.length > 0 ? [counts] : [],
	};
}

/**
 * Per-member outcome of a collection install, discriminated on `status`.
 *
 * The `installed` variant carries a REQUIRED `detectedType` narrowed to the two
 * standalone variants — every installed member resolved to a bare-skill or
 * plugin (collection/not-agntc members are filtered to `skipped` before any
 * installed result is produced), so the type system guarantees the manifest
 * loop never needs a runtime "missing type" guard. The `skipped`/`failed`
 * variant omits `detectedType`; `failed` additionally carries the
 * `errorMessage`.
 */
export type PluginInstallResult =
	| {
			pluginName: string;
			/**
			 * The member's dir-relative source SEGMENT within the collection root
			 * ("alpha" for a root-child member, "skills/alpha" for a skills-only inner
			 * skill). Identity is the basename (`pluginName`); this records WHERE the
			 * source dir is so the step-6 manifest write can persist a divergent
			 * `sourceSubpath` (cycle-9) when segment !== basename, keeping the member
			 * updatable. Equal to `pluginName` for root-child members.
			 */
			pluginSegment: string;
			status: "installed";
			copiedFiles: string[];
			detectedType: Extract<DetectedType, { type: "bare-skill" | "plugin" }>;
	  }
	| {
			pluginName: string;
			status: "skipped" | "failed";
			copiedFiles: string[];
			errorMessage?: string;
	  };

interface CollectionAddSummaryInput {
	manifestKey: string;
	ref: string | null;
	commit: string | null;
	results: PluginInstallResult[];
}

export function renderCollectionAddSummary(
	input: CollectionAddSummaryInput,
): RenderedSummary {
	const refLabel = formatRefLabel(input.ref, input.commit);
	const installed = input.results.filter(
		(r): r is Extract<PluginInstallResult, { status: "installed" }> =>
			r.status === "installed",
	);
	const skipped = input.results.filter((r) => r.status === "skipped");
	const failed = input.results.filter(
		(r): r is Extract<PluginInstallResult, { status: "skipped" | "failed" }> =>
			r.status === "failed",
	);

	const detail: string[] = installed.map((r) => r.pluginName);

	if (skipped.length > 0) {
		detail.push(`${skipped.length} skipped`);
	}
	for (const f of failed) {
		detail.push(`${f.pluginName}: failed — ${f.errorMessage}`);
	}

	return { headline: `Installed ${input.manifestKey}@${refLabel}`, detail };
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
