import type { Tally } from "../ui.js";
import type { Status, TallyItem } from "./types.js";

interface Look {
	label: string;
	status: Status;
}

/** Each command's categories, in the order its tally shows them. */
const LOOKS: { [T in Tally as T["command"]]: Record<keyof T["counts"], Look> } =
	{
		update: {
			updated: { label: "updated", status: "done" },
			refreshed: { label: "refreshed", status: "done" },
			upToDate: { label: "up to date", status: "unchanged" },
			notChecked: { label: "not checked", status: "attention" },
			notUpdated: { label: "not updated", status: "failed" },
			failed: { label: "failed", status: "failed" },
			removed: { label: "removed", status: "done" },
			kept: { label: "kept", status: "attention" },
		},
		add: {
			installed: { label: "installed", status: "done" },
			skipped: { label: "skipped", status: "attention" },
			failed: { label: "failed", status: "failed" },
		},
		remove: {
			removed: { label: "removed", status: "done" },
			failed: { label: "failed", status: "failed" },
		},
		list: {
			updated: { label: "updated", status: "done" },
			versionChanged: { label: "version changed", status: "done" },
			removed: { label: "removed", status: "done" },
		},
	};

/** Every category of the tally's command in its order, one it leaves out counted 0. */
export function tallyItems(tally: Tally): TallyItem[] {
	const counts = new Map<string, number>(Object.entries(tally.counts));
	return Object.entries(LOOKS[tally.command]).map(([category, look]) => ({
		count: counts.get(category) ?? 0,
		...look,
	}));
}

/** How many outcomes the tally counts. */
export function outcomeCount(tally: Tally): number {
	return tallyItems(tally).reduce((total, { count }) => total + count, 0);
}
