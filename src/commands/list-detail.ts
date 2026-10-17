import { isUpdatable } from "../key-update.js";
import type { Row } from "../terminal/types.js";
import type { Ui } from "../ui.js";
import type { UpdateCheckResult } from "../update-check.js";
import { isVersionTag } from "../version-resolve.js";

export type DetailAction = "update" | "remove" | "change-version" | "back";

interface ActionChoice {
	value: DetailAction;
	label: string;
}

/**
 * What can be done with an entry: update it when there's an update in range
 * (or it's local), change its version when it's pinned to a tag whose
 * remote could be reached, remove it, or go back.
 */
export function detailActions(
	ref: string | null,
	check: UpdateCheckResult,
): ActionChoice[] {
	const actions: ActionChoice[] = [];

	// A tag-pinned install at the latest tag has nothing to update: it switches
	// versions through "Change version" instead.
	if (isUpdatable(check)) {
		actions.push({ value: "update", label: "Update" });
	}

	// Any tag-pinned install can jump to any other tag, newer or older, but
	// only when the remote can be reached to list them: HEAD, branch and local
	// installs have no tag list to choose from.
	if (isVersionTag(ref) && check.status !== "check-failed") {
		actions.push({ value: "change-version", label: "Change version" });
	}

	actions.push(
		{ value: "remove", label: "Remove" },
		{ value: "back", label: "Back" },
	);
	return actions;
}

/**
 * Asks what to do with the entry under its row, which the question erases
 * with it: back when cancelled.
 */
export async function askAction(
	row: Row,
	ref: string | null,
	check: UpdateCheckResult,
	ui: Ui,
): Promise<DetailAction> {
	const selected = await ui.block([row]).select<DetailAction>(row, {
		message: "Action",
		options: detailActions(ref, check),
		escape: "back",
	});
	return selected ?? "back";
}
