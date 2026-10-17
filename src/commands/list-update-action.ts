import {
	type UpdatableCheck,
	type UpdateRun,
	updatePlan,
	updateUnderRow,
} from "../key-update.js";
import { type ListActionResult, reinstallResult } from "../list-render.js";
import type { Manifest } from "../manifest.js";
import type { GroupMember } from "../update-groups.js";

/**
 * Updates the entry as `update <key>` does once its check found something:
 * under the same row, to where its check found it can go.
 */
export async function executeUpdateAction(
	member: GroupMember,
	check: UpdatableCheck,
	manifest: Manifest,
	run: UpdateRun,
): Promise<ListActionResult> {
	const outcome = await updateUnderRow(
		member,
		manifest,
		run,
		updatePlan(member.entry, check),
	);
	return reinstallResult(member.key, outcome, "updated");
}
