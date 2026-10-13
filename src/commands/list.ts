import { Command } from "commander";
import { commandAction, jsonOption } from "../command-action.js";
import { listBody } from "../documents.js";
import {
	type Manifest,
	type ManifestEntry,
	readManifest,
	readManifestOrExit,
} from "../manifest.js";
import { interactiveUi, type Ui } from "../ui.js";
import { checkForUpdate, type UpdateCheckResult } from "../update-check.js";
import { checkAllForUpdates, checkResultFor } from "../update-check-all.js";
import { executeChangeVersionAction } from "./list-change-version-action.js";
import { renderDetailView } from "./list-detail.js";
import { executeRemoveAction } from "./list-remove-action.js";
import { executeUpdateAction } from "./list-update-action.js";

// The label shows just the unit + its installed version; the constraint and any
// out-of-constraint version live in the detail view, so the list stays scannable.
function formatLabel(key: string, entry: ManifestEntry): string {
	const ref = entry.ref ?? (entry.commit !== null ? "HEAD" : "local");
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
	ui: Ui,
): Promise<string | null> {
	const options = Object.entries(manifest).map(([key, entry]) => ({
		value: key,
		label: formatLabel(key, entry),
		hint: formatStatusHint(checkResultFor(checkResults, key)),
	}));

	return ui.select<string>({
		message: "Select a plugin to manage  (Esc when done)",
		options,
	});
}

/** The dashboard at a terminal; in machine mode, one document of every entry and its update status. */
export async function runList(ui: Ui = interactiveUi): Promise<void> {
	if (ui.mode === "machine") {
		const manifest = await readManifestOrExit(process.cwd(), ui);
		ui.report(listBody(manifest, await checkAllForUpdates(manifest)));
		return;
	}
	await runListLoop(ui);
}

export async function runListLoop(ui: Ui = interactiveUi): Promise<void> {
	ui.intro("agntc list");

	const projectDir = process.cwd();

	while (true) {
		const manifest = await readManifestOrExit(projectDir, ui);

		const entries = Object.entries(manifest);

		if (entries.length === 0) {
			ui.outro(
				"No plugins installed. Run npx agntc add owner/repo to get started.",
			);
			return;
		}

		const spin = ui.spinner();
		spin.start("Checking for updates...");
		const checkResults = await checkAllForUpdates(manifest);
		spin.stop("Update checks complete.");

		const selectedKey = await showListView(manifest, checkResults, ui);

		if (selectedKey === null) {
			return;
		}

		const entry = manifest[selectedKey];
		if (!entry) {
			continue;
		}

		// Reuse the status from the list-wide check for the first detail render — no
		// redundant network round-trip (and no silent pause) on entry. Only re-check
		// (with a spinner) on later renders, after an action may have changed it.
		let firstRender = true;

		while (true) {
			const freshManifest = await readManifest(projectDir);
			const freshEntry = freshManifest[selectedKey];
			if (!freshEntry) break;

			let freshStatus = firstRender ? checkResults.get(selectedKey) : undefined;
			if (!freshStatus) {
				const checkSpin = ui.spinner();
				checkSpin.start("Checking for updates...");
				freshStatus = await checkForUpdate(selectedKey, freshEntry);
				checkSpin.stop("Update check complete.");
			}
			firstRender = false;

			const action = await renderDetailView(
				{
					key: selectedKey,
					entry: freshEntry,
					updateStatus: freshStatus,
				},
				ui,
			);

			if (action === "back") break;

			if (action === "remove") {
				const result = await executeRemoveAction(
					selectedKey,
					freshEntry,
					freshManifest,
					projectDir,
					ui,
				);
				if (result.removed) {
					ui.log.success(result.message);
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
					ui,
					overrides,
				);
				if (result.success) {
					reportNote(result.note, ui);
					ui.log.success(result.message);
				} else {
					ui.log.error(result.message);
				}
				continue;
			}

			if (action === "change-version") {
				const result = await executeChangeVersionAction(
					selectedKey,
					freshEntry,
					freshManifest,
					projectDir,
					ui,
				);
				if (result.changed) {
					reportNote(result.note, ui);
					ui.log.success(result.message);
				} else if (result.message !== "Cancelled") {
					ui.log.error(result.message);
				}
			}
		}
	}
}

function reportNote(note: string | undefined, ui: Ui): void {
	if (note !== undefined) {
		ui.note(note);
	}
}

export const listCommand = new Command("list")
	.description("List installed plugins")
	.addOption(jsonOption())
	.action(commandAction("list", (ui) => runList(ui)));
