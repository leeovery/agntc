import * as p from "@clack/prompts";
import { identifyFileOwnership } from "../drivers/identify.js";
import type { ManifestEntry } from "../manifest.js";
import { formatRefLabel } from "../summary.js";
import type { UpdateCheckResult } from "../update-check.js";

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
	const parts: string[] = [];
	if (counts.skills > 0) parts.push(`${counts.skills} skill(s)`);
	if (counts.agents > 0) parts.push(`${counts.agents} agent(s)`);
	if (counts.hooks > 0) parts.push(`${counts.hooks} hook(s)`);
	if (counts.other > 0) parts.push(`${counts.other} other`);
	return parts.join(", ");
}

function getActions(
	status: UpdateCheckResult["status"],
): Array<{ value: DetailAction; label: string }> {
	switch (status) {
		case "update-available":
			return [
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			];
		case "up-to-date":
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

	p.log.info(`Plugin: ${key}`);
	p.log.info(`Ref: ${formatRefLabel(entry.ref, entry.commit)}`);
	p.log.info(`Commit: ${formatCommit(entry)}`);
	p.log.info(`Installed: ${formatDate(entry.installedAt)}`);
	p.log.info(`Agents: ${entry.agents.join(", ")}`);

	const perAgent = computePerAgentCounts(entry.files);
	const agentOrder = ["claude", "codex", "other"];
	for (const agent of agentOrder) {
		const counts = perAgent.get(agent);
		if (counts) {
			p.log.info(`  ${agent}: ${formatAssetCounts(counts)}`);
		}
	}

	for (const file of entry.files) {
		p.log.message(`  ${file}`);
	}

	const actions = getActions(updateStatus.status);

	const selected = await p.select<DetailAction>({
		message: "Action",
		options: actions,
	});

	if (p.isCancel(selected)) {
		return "back";
	}

	return selected;
}
