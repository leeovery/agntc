import { errorMessage, gitErrorCause } from "../errors.js";
import { fetchRemoteTagRefs, type TagRef } from "../git-utils.js";
import { keyHead, type UpdateRun, updateUnderRow } from "../key-update.js";
import {
	type ListActionResult,
	reinstallResult,
	versionUnchangedRow,
} from "../list-render.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { deriveCloneUrlFromKey } from "../source-parser.js";
import type { Detail, Row, Status } from "../terminal/types.js";
import type { Block } from "../ui.js";
import type { GroupMember } from "../update-groups.js";

/**
 * Caps the version list's window, so a repo with hundreds of tags scrolls
 * within it rather than flooding the terminal.
 */
const MAX_VISIBLE_VERSIONS = 15;

function stripConstraint(manifestEntry: ManifestEntry): ManifestEntry {
	const { constraint: _, ...rest } = manifestEntry;
	return rest;
}

/**
 * Pins the entry to a tag the user picks, newer or older, under the entry's
 * row, then reinstalls it there under the row `update <key>` draws. The pick
 * and its confirmation erase with the question, leaving nothing when either
 * is turned down.
 */
export async function executeChangeVersionAction(
	member: GroupMember,
	row: Row,
	manifest: Manifest,
	run: UpdateRun,
	progress: Block,
): Promise<ListActionResult> {
	const { key, entry } = member;
	const unchanged = (status: Status, detail: Detail): ListActionResult => {
		const said = versionUnchangedRow(
			keyHead(member, run.home),
			key,
			status,
			detail,
		);
		run.ui.block([said]).row(said);
		return { key, change: null };
	};

	const fetched = await fetchVersions(
		key,
		deriveCloneUrlFromKey(key, entry.cloneUrl),
		progress,
	);
	if ("cause" in fetched) {
		return unchanged("attention", {
			label: "couldn't fetch its versions",
			aside: fetched.cause,
		});
	}
	if (fetched.tags.length === 0) {
		return unchanged("attention", { label: "no tagged versions available" });
	}

	const block = run.ui.block([row]);
	const picked = await block.select(row, {
		message: "Select a version",
		// Newest first, the installed tag flagged, so either way is in view.
		options: fetched.tags.map((tag) => ({
			value: tag,
			label: tag.tag,
			...(tag.tag === entry.ref ? { hint: "current" } : {}),
		})),
		maxItems: MAX_VISIBLE_VERSIONS,
	});
	if (picked === null) {
		return { key, change: null };
	}
	if (picked.tag === entry.ref) {
		return unchanged("unchanged", `already on ${picked.tag}`);
	}

	// Changing version reinstalls at the exact tag, dropping any constraint:
	// confirmed before anything changes.
	const confirmed = await block.confirm(row, {
		message: `Change ${key} to ${picked.tag}? This re-installs it at the new version.`,
	});
	if (!confirmed) {
		return { key, change: null };
	}

	// It reinstalls as the entry it becomes, pinned to the tag, so a recovery
	// re-adds that tag.
	const outcome = await updateUnderRow(
		{ key, entry: stripConstraint(entry) },
		manifest,
		run,
		{
			target: { newRef: picked.tag, newCommit: picked.sha },
			overrides: { newRef: picked.tag },
			version: picked.tag,
		},
	);
	return reinstallResult(key, outcome, "versionChanged");
}

/**
 * The remote's tags, newest first, or why they couldn't be listed: a network
 * round-trip, under progress that clears.
 */
async function fetchVersions(
	key: string,
	url: string,
	progress: Block,
): Promise<{ tags: TagRef[] } | { cause: string }> {
	const fetching = progress.task({ text: `fetching the versions of ${key}…` });
	try {
		return { tags: [...(await fetchRemoteTagRefs(url))].reverse() };
	} catch (err: unknown) {
		return { cause: gitErrorCause(errorMessage(err)) };
	} finally {
		fetching.clear();
	}
}
