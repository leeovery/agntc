import * as p from "@clack/prompts";
import { identifyFileOwnership } from "../drivers/identify.js";
import type { ManifestEntry } from "../manifest.js";
import { formatRefLabel } from "../summary.js";
import {
	hasOutOfConstraintVersion,
	type UpdateCheckResult,
} from "../update-check.js";

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

function getActions(
	updateResult: UpdateCheckResult,
): Array<{ value: DetailAction; label: string }> {
	switch (updateResult.status) {
		case "update-available":
			return [
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "constrained-update-available":
			return [
				{ value: "update", label: "Update" },
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "up-to-date":
			return [
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "constrained-up-to-date":
			if (updateResult.latestOverall !== null) {
				return [
					{ value: "change-version", label: "Change version" },
					{ value: "remove", label: "Remove" },
					{ value: "back", label: "Back" },
				];
			}
			return [
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "newer-tags":
			return [
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "check-failed":
		case "constrained-no-match":
			return [
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "local":
			return [
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
	}
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

	const actions = getActions(updateStatus);

	const selected = await p.select<DetailAction>({
		message: "Action",
		options: actions,
	});

	if (p.isCancel(selected)) {
		return "back";
	}

	return selected;
}
