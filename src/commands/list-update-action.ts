import { errorMessage } from "../errors.js";
import {
	failedKey,
	type KeyPlan,
	keyRowProgress,
	REFRESHING,
	reinstallKey,
	type UpdatableCheck,
	type UpdateRun,
	updatePlan,
	updateUnderRow,
} from "../key-update.js";
import { type ListActionResult, reinstallResult } from "../list-render.js";
import type { Manifest } from "../manifest.js";
import {
	failedOutcome,
	type GroupMember,
	type PluginOutcome,
} from "../update-groups.js";

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
	const outcome = await reinstallInSession(
		member,
		manifest,
		run,
		updatePlan(member.entry, check),
	);
	return reinstallResult(member.key, outcome, "updated");
}

/**
 * Reinstalls the entry under its own row, as `update <key>` does: a local
 * one, with no plan, refreshing from its folder. Either way a throw ends it
 * as failed and the session carries on: a reinstall's settles the row so;
 * a manifest write's, once the row has said what reached the disk, is
 * warned of under it.
 */
export async function reinstallInSession(
	member: GroupMember,
	manifest: Manifest,
	run: UpdateRun,
	plan?: KeyPlan,
): Promise<PluginOutcome> {
	const progress = keyRowProgress(member, manifest, run, plan?.version);
	if (plan === undefined) {
		progress.say(REFRESHING);
	}
	try {
		return await updateUnderRow(progress, manifest, run, () =>
			reinstallKey(member, manifest, progress, run, plan).catch(
				(err: unknown) => failedKey(member, err, run, plan),
			),
		);
	} catch (err) {
		run.ui.warn(`couldn't record ${member.key}: ${errorMessage(err)}`);
		return failedOutcome(member.key, errorMessage(err));
	}
}
