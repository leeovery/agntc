import { KNOWN_AGENTS } from "./config.js";
import type { AssetCounts } from "./copy-plugin-assets.js";
import { getDriver } from "./drivers/registry.js";
import type { AgentId, AssetType } from "./drivers/types.js";
import type { DetectedType } from "./type-detection.js";
import { formatVersionMove } from "./version-resolve.js";

/**
 * A rendered install summary: a one-line `headline` (the terminal `└` outro
 * node) plus zero or more `detail` lines emitted as gutterred `│` log nodes
 * ABOVE it, so the per-agent/per-member breakdown stays connected to the prompt
 * tree instead of floating below the outro as raw text.
 */
export interface RenderedSummary {
	headline: string;
	detail: string[];
}

/** Orders agents by the canonical KNOWN_AGENTS order (claude, codex, cursor). */
function sortByKnownAgents(ids: AgentId[]): AgentId[] {
	return [...ids].sort(
		(a, b) => KNOWN_AGENTS.indexOf(a) - KNOWN_AGENTS.indexOf(b),
	);
}

/** Pads the name column so the detail columns line up across rows. */
function alignAgentRows(rows: { name: string; detail: string }[]): string[] {
	const width = rows.reduce((max, r) => Math.max(max, r.name.length), 0);
	return rows.map((r) => `${r.name.padEnd(width)}  ${r.detail}`);
}

export function formatDroppedAgentsSuffix(
	droppedAgents: string[],
	style: "sentence" | "inline" | "parenthetical",
): string {
	if (droppedAgents.length === 0) return "";
	const agents = droppedAgents.join(", ");
	if (style === "sentence") {
		return `. ${agents} support removed by plugin author.`;
	}
	// The bare notice body \u2014 no leading separator \u2014 for callers that supply their
	// own delimiter (the per-member parenthetical suffix shares one `(...)` with
	// the version move, joining parts with `; `).
	if (style === "parenthetical") {
		return `${agents} support removed by plugin author`;
	}
	return ` \u2014 ${agents} support removed by plugin author`;
}

export function capitalizeAgentName(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
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

export function formatPluginSummary(
	agentIds: AgentId[],
	assetCountsByAgent: Partial<Record<AgentId, AssetCounts>>,
): string[] {
	const rows: { name: string; detail: string }[] = [];

	for (const id of sortByKnownAgents(agentIds)) {
		const counts = assetCountsByAgent[id];
		const nonZero = counts
			? Object.entries(counts)
					.filter(([, count]) => count > 0)
					.map(([type, count]) => pluralize(count, type.replace(/s$/, "")))
					.join(", ")
			: "";

		// A selected agent that received no compatible files is still listed —
		// silently dropping it leaves the user unsure whether their selection took
		// effect or errored. (e.g. an agents/hooks-only plugin installed for
		// codex/cursor, which today only receive skills.)
		rows.push({
			name: capitalizeAgentName(id),
			detail:
				nonZero.length > 0
					? nonZero
					: "nothing to install (no compatible files)",
		});
	}

	return alignAgentRows(rows);
}

export function formatBareSkillSummary(
	agentIds: AgentId[],
	copiedFiles: string[],
): string[] {
	const rows: { name: string; detail: string }[] = [];

	for (const id of sortByKnownAgents(agentIds)) {
		const driver = getDriver(id);
		const targetPrefix = driver.getTargetDir("skills");
		const count = copiedFiles.filter(
			(f) => targetPrefix !== null && f.startsWith(targetPrefix),
		).length;

		if (count > 0) {
			rows.push({
				name: capitalizeAgentName(id),
				detail: pluralize(count, "skill"),
			});
		}
	}

	return alignAgentRows(rows);
}

interface AddSummaryInput {
	manifestKey: string;
	ref: string | null;
	commit: string | null;
	detectedType: "plugin" | "bare-skill";
	selectedAgents: AgentId[];
	assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
	copiedFiles: string[];
}

export function renderAddSummary(input: AddSummaryInput): RenderedSummary {
	const refLabel = formatRefLabel(input.ref, input.commit);
	const detail =
		input.detectedType === "plugin" && input.assetCountsByAgent
			? formatPluginSummary(input.selectedAgents, input.assetCountsByAgent)
			: formatBareSkillSummary(input.selectedAgents, input.copiedFiles);

	return { headline: `Installed ${input.manifestKey}@${refLabel}`, detail };
}

/**
 * Per-member outcome of a collection install, discriminated on `status`.
 *
 * The `installed` variant carries a REQUIRED `detectedType` narrowed to the two
 * standalone variants — every installed member resolved to a bare-skill or
 * plugin (collection/not-agntc members are filtered to `skipped` before any
 * installed result is produced), so the type system guarantees the manifest
 * loop never needs a runtime "missing type" guard. The `skipped`/`failed`
 * variant omits `detectedType` (and `assetCountsByAgent`); `failed` additionally
 * carries the `errorMessage`.
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
			agents: AgentId[];
			assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
			detectedType: Extract<DetectedType, { type: "bare-skill" | "plugin" }>;
	  }
	| {
			pluginName: string;
			status: "skipped" | "failed";
			copiedFiles: string[];
			agents: AgentId[];
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

	// One compact line per installed member: "<member> → <agents>", member names
	// aligned. Keeps the collection overview to one row per member (not one row
	// per agent) so it scales to large collections.
	const width = installed.reduce(
		(max, r) => Math.max(max, r.pluginName.length),
		0,
	);
	const detail: string[] = installed.map(
		(r) => `${r.pluginName.padEnd(width)} → ${r.agents.join(", ")}`,
	);

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
	effectiveAgents: string[];
	droppedAgents: string[];
}

export function renderGitUpdateSummary(input: GitUpdateSummaryInput): string {
	const move = formatVersionMove({
		oldRef: input.oldRef,
		newRef: input.newRef,
		oldCommit: input.oldCommit,
		newCommit: input.newCommit,
	});
	const droppedSuffix = formatDroppedAgentsSuffix(
		input.droppedAgents,
		"sentence",
	);
	return `Updated ${input.key}: ${move} — ${input.copiedFiles.length} file(s) for ${input.effectiveAgents.join(", ")}${droppedSuffix}`;
}

interface LocalUpdateSummaryInput {
	key: string;
	copiedFiles: string[];
	effectiveAgents: string[];
	droppedAgents: string[];
}

export function renderLocalUpdateSummary(
	input: LocalUpdateSummaryInput,
): string {
	const droppedSuffix = formatDroppedAgentsSuffix(
		input.droppedAgents,
		"sentence",
	);
	return `Refreshed ${input.key} — ${input.copiedFiles.length} file(s) for ${input.effectiveAgents.join(", ")}${droppedSuffix}`;
}

type UpdateOutcomeInput =
	| {
			type: "git-update";
			key: string;
			oldRef: string | null;
			newRef: string | null;
			oldCommit: string | null;
			newCommit: string;
			droppedAgents: string[];
	  }
	| {
			type: "local-update";
			key: string;
			droppedAgents: string[];
	  };

export function renderUpdateOutcomeSummary(input: UpdateOutcomeInput): string {
	if (input.type === "git-update") {
		const move = formatVersionMove({
			oldRef: input.oldRef,
			newRef: input.newRef,
			oldCommit: input.oldCommit,
			newCommit: input.newCommit,
		});
		const droppedSuffix = formatDroppedAgentsSuffix(
			input.droppedAgents,
			"inline",
		);
		return `${input.key}: Updated ${move}${droppedSuffix}`;
	}

	const droppedSuffix = formatDroppedAgentsSuffix(
		input.droppedAgents,
		"inline",
	);
	return `${input.key}: Refreshed from local path${droppedSuffix}`;
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
