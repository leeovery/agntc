import * as p from "@clack/prompts";
import { Command } from "commander";
import { withExitSignal } from "../exit-signal.js";
import {
	type Manifest,
	type ManifestEntry,
	readManifest,
	readManifestOrExit,
} from "../manifest.js";
import { checkForUpdate, type UpdateCheckResult } from "../update-check.js";
import { checkAllForUpdates } from "../update-check-all.js";
import { executeChangeVersionAction } from "./list-change-version-action.js";
import { renderDetailView } from "./list-detail.js";
import { executeRemoveAction } from "./list-remove-action.js";
import { executeUpdateAction } from "./list-update-action.js";

// The label shows just the unit + its installed version; the constraint and any
// out-of-constraint version live in the detail view, so the list stays scannable.
function formatLabel(key: string, entry: ManifestEntry): string {
	const ref =
		entry.ref ?? (entry.commit !== null ? "HEAD" : "local");
	return `${key}  ${ref}`;
}

// Terse, single-clause status for the select hint (clack wraps it in parens).
// Rich version detail (which tag, out-of-constraint) is shown in the detail view.
function formatStatusHint(result: UpdateCheckResult): string {
	switch (result.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return "\u2713 up to date";
		case "update-available":
		case "constrained-update-available":
			return "\u2191 update available";
		case "newer-tags":
			return "\u2691 newer tags";
		case "check-failed":
			return "\u2717 check failed";
		case "local":
			return "\u25CF local";
		case "constrained-no-match":
			return "\u2717 no matching version";
	}
}

async function showListView(
	manifest: Manifest,
	checkResults: Map<string, UpdateCheckResult>,
): Promise<string | null> {
	const entries = Object.entries(manifest);

	const options = entries.map(([key, entry]) => {
		const result = checkResults.get(key) ?? {
			status: "check-failed" as const,
			reason: "unknown",
		};
		return {
			value: key,
			label: formatLabel(key, entry),
			hint: formatStatusHint(result),
		};
	});

	const selected = await p.select<string>({
		message: "Select a plugin to manage  (Esc when done)",
		options,
	});

	if (p.isCancel(selected)) {
		return null;
	}

	return selected;
}

export async function runListLoop(): Promise<void> {
	const projectDir = process.cwd();

	while (true) {
		const manifest = await readManifestOrExit(projectDir);

		const entries = Object.entries(manifest);

		if (entries.length === 0) {
			p.outro(
				"No plugins installed. Run npx agntc add owner/repo to get started.",
			);
			return;
		}

		const spin = p.spinner();
		spin.start("Checking for updates...");
		const checkResults = await checkAllForUpdates(manifest);
		spin.stop("Update checks complete.");

		const selectedKey = await showListView(manifest, checkResults);

		if (selectedKey === null) {
			return;
		}

		const entry = manifest[selectedKey];
		if (!entry) {
			continue;
		}

		while (true) {
			const freshManifest = await readManifest(projectDir);
			const freshEntry = freshManifest[selectedKey];
			if (!freshEntry) break;

			const freshStatus = await checkForUpdate(selectedKey, freshEntry);

			const action = await renderDetailView({
				key: selectedKey,
				entry: freshEntry,
				updateStatus: freshStatus,
			});

			if (action === "back") break;

			if (action === "remove") {
				const result = await executeRemoveAction(
					selectedKey,
					freshEntry,
					freshManifest,
					projectDir,
				);
				if (result.removed) {
					p.log.success(result.message);
				}
				break;
			}

			if (action === "update") {
				const overrides =
					freshStatus.status === "constrained-update-available"
						? { newRef: freshStatus.tag, newCommit: freshStatus.commit }
						: undefined;
				const result = await executeUpdateAction(
					selectedKey,
					freshEntry,
					freshManifest,
					projectDir,
					overrides,
				);
				if (result.success) {
					p.log.success(result.message);
				} else {
					p.log.error(result.message);
				}
				continue;
			}

			if (action === "change-version") {
				const result = await executeChangeVersionAction(
					selectedKey,
					freshEntry,
					freshManifest,
					projectDir,
					freshStatus,
				);
				if (result.changed) {
					p.log.success(result.message);
				} else if (result.message !== "Cancelled") {
					p.log.error(result.message);
				}
			}
		}
	}
}

export const listCommand = new Command("list")
	.description("List installed plugins")
	.action(
		withExitSignal(async () => {
			await runListLoop();
		}),
	);
