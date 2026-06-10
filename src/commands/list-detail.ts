import * as p from "@clack/prompts";
import { identifyFileOwnership } from "../drivers/identify.js";
import type { ManifestEntry } from "../manifest.js";
import { formatRefLabel } from "../summary.js";
import {
	hasOutOfConstraintVersion,
	type UpdateCheckResult,
} from "../update-check.js";
import { isVersionTag } from "../version-resolve.js";

export type DetailAction = "update" | "remove" | "change-version" | "back";

export interface DetailViewInput {
	key: string;
	entry: ManifestEntry;
	updateStatus: UpdateCheckResult;
}

function formatCommit(entry: ManifestEntry): string {
	if (entry.commit) return entry.commit.slice(0, 7);
	return "\u2014";
}

function formatDate(isoDate: string): string {
	return isoDate.slice(0, 10);
}

interface AssetCounts {
	skills: number;
	agents: number;
	hooks: number;
	other: number;
}

function computePerAgentCounts(files: string[]): Map<string, AssetCounts> {
	const map = new Map<string, AssetCounts>();
	for (const file of files) {
		const ownership = identifyFileOwnership(file);
		const agent = ownership?.agentId ?? "other";
		const assetType: keyof AssetCounts = ownership?.assetType ?? "other";
		if (!map.has(agent)) {
			map.set(agent, { skills: 0, agents: 0, hooks: 0, other: 0 });
		}
		const counts = map.get(agent)!;
		counts[assetType]++;
	}
	return map;
}

function formatAssetCounts(counts: AssetCounts): string {
	const plural = (n: number, word: string) =>
		`${n} ${word}${n === 1 ? "" : "s"}`;
	const parts: string[] = [];
	if (counts.skills > 0) parts.push(plural(counts.skills, "skill"));
	if (counts.agents > 0) parts.push(plural(counts.agents, "agent"));
	if (counts.hooks > 0) parts.push(plural(counts.hooks, "hook"));
	if (counts.other > 0) parts.push(`${counts.other} other`);
	return parts.join(", ");
}

// `canChangeVersion` is decided by the caller from the installed ref (tag-based)
// and reachability — see renderDetailView.
function getActions(
	updateResult: UpdateCheckResult,
	canChangeVersion: boolean,
): Array<{ value: DetailAction; label: string }> {
	const actions: Array<{ value: DetailAction; label: string }> = [];

	// "Update" applies only when there's an in-range (or HEAD) update to pull.
	// A tag-pinned install at the latest tag has nothing to "update" — it switches
	// versions via "Change version" instead.
	if (
		updateResult.status === "update-available" ||
		updateResult.status === "constrained-update-available" ||
		updateResult.status === "local"
	) {
		actions.push({ value: "update", label: "Update" });
	}

	// "Change version" lets any tag-pinned install jump to any other tag — newer
	// or older. Gated so HEAD/branch/local installs and unreachable remotes (where
	// there's no tag list to choose from) don't offer it.
	if (canChangeVersion) {
		actions.push({ value: "change-version", label: "Change version" });
	}

	actions.push(
		{ value: "remove", label: "Remove" },
		{ value: "back", label: "Back" },
	);
	return actions;
}

export async function renderDetailView(
	input: DetailViewInput,
): Promise<DetailAction> {
	const { key, entry, updateStatus } = input;

	// The out-of-constraint version (when present) folds into the Constraint line
	// rather than a separate trailing bullet.
	const outOfConstraint = hasOutOfConstraintVersion(updateStatus)
		? ` (${updateStatus.latestOverall} available outside constraint)`
		: "";

	p.log.info(`Plugin: ${key}`);
	p.log.info(`Ref: ${formatRefLabel(entry.ref, entry.commit)}`);
	if (entry.constraint) {
		p.log.info(`Constraint: ${entry.constraint}${outOfConstraint}`);
	}
	p.log.info(`Commit: ${formatCommit(entry)}`);
	p.log.info(`Installed: ${formatDate(entry.installedAt)}`);

	// One compact agents line with per-agent counts — no repeated agents list,
	// no per-agent sub-bullets, no raw file-path dump.
	const perAgent = computePerAgentCounts(entry.files);
	const agentSummary = entry.agents
		.map((agent) => {
			const counts = perAgent.get(agent);
			return counts ? `${agent} (${formatAssetCounts(counts)})` : agent;
		})
		.join(", ");
	p.log.info(`Agents: ${agentSummary}`);

	if (updateStatus.status === "constrained-no-match") {
		p.log.error(
			`No matching version found for constraint "${entry.constraint}"`,
		);
	}

	// A tag-pinned install (ref parses as a version) can switch to any other tag,
	// but only when we can actually reach the remote to list them.
	const canChangeVersion =
		isVersionTag(entry.ref) && updateStatus.status !== "check-failed";
	const actions = getActions(updateStatus, canChangeVersion);

	const selected = await p.select<DetailAction>({
		message: "Action",
		options: actions,
	});

	if (p.isCancel(selected)) {
		return "back";
	}

	return selected;
}
