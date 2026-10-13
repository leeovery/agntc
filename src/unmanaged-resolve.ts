import { formatFileList } from "./format-file-list.js";
import type { Ui } from "./ui.js";

export interface UnmanagedPluginConflicts {
	pluginKey: string;
	files: string[];
}

export interface UnmanagedResolution {
	approved: string[];
	cancelled: string[];
}

/**
 * Asks, per plugin, whether to overwrite its unmanaged files (confirmed a
 * second time) or cancel that plugin's install.
 *
 * @param conflicts - Per-plugin conflict groups
 * @returns Approved files (OK to overwrite) and cancelled files (skip install)
 */
export async function resolveUnmanagedConflicts(
	conflicts: UnmanagedPluginConflicts[],
	ui: Ui,
): Promise<UnmanagedResolution> {
	const approved: string[] = [];
	const cancelled: string[] = [];

	for (const { pluginKey, files } of conflicts) {
		if (await approveOverwrite(pluginKey, files, ui)) {
			approved.push(...files);
		} else {
			cancelled.push(...files);
		}
	}

	return { approved, cancelled };
}

async function approveOverwrite(
	pluginKey: string,
	files: string[],
	ui: Ui,
): Promise<boolean> {
	ui.box(formatFileList(files), `Unmanaged files for "${pluginKey}"`);

	const choice = await ui.select({
		message: `How would you like to proceed with "${pluginKey}"?`,
		options: [
			{
				value: "overwrite" as const,
				label: "Overwrite all — replace these files",
			},
			{
				value: "cancel" as const,
				label: "Cancel this plugin's install",
			},
		],
	});
	if (choice !== "overwrite") {
		return false;
	}

	return ui.confirm({
		message: "Are you sure? These files will be permanently replaced.",
	});
}
