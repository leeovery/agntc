import type { EntryHead } from "./entry-head.js";
import { unmanagedRow } from "./in-the-way-render.js";
import type { Row } from "./terminal/types.js";
import type { Ui } from "./ui.js";

export interface UnmanagedPluginConflicts {
	/** The item, as its question's row names it. */
	head: EntryHead;
	files: string[];
}

export interface UnmanagedResolution {
	approved: string[];
	cancelled: string[];
}

/**
 * Asks, per entry, under its row naming it and the files, whether to
 * overwrite its unmanaged files (confirmed a second time) or cancel that
 * entry's install.
 *
 * @param conflicts - Per-entry conflict groups
 * @returns Approved files (OK to overwrite) and cancelled files (skip install)
 */
export async function resolveUnmanagedConflicts(
	conflicts: UnmanagedPluginConflicts[],
	ui: Ui,
): Promise<UnmanagedResolution> {
	const approved: string[] = [];
	const cancelled: string[] = [];

	for (const { head, files } of conflicts) {
		const row = unmanagedRow(head, files);
		if (await approveOverwrite(row, ui)) {
			approved.push(...files);
		} else {
			cancelled.push(...files);
		}
	}

	return { approved, cancelled };
}

async function approveOverwrite(row: Row, ui: Ui): Promise<boolean> {
	const block = ui.block([row]);
	const choice = await block.select(row, {
		message: "How would you like to proceed?",
		options: [
			{
				value: "overwrite" as const,
				label: "Overwrite all — replace these files",
			},
			{
				value: "cancel" as const,
				label: "Cancel this install",
			},
		],
	});
	if (choice !== "overwrite") {
		return false;
	}

	return block.confirm(row, {
		message: "Are you sure? These files will be permanently replaced.",
	});
}
