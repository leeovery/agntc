import {
	cloneAndReinstall,
	failureMessage,
	isCloneReinstallFailure,
	prepareReinstall,
	recordReinstall,
} from "../clone-reinstall.js";
import { fetchRemoteTags } from "../git-utils.js";
import { settleGoneInList } from "../gone-upstream.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { writeManifest } from "../manifest.js";
import type { Scope } from "../scope.js";
import { deriveCloneUrlFromKey } from "../source-parser.js";
import type { Ui } from "../ui.js";

/**
 * `changed` is false when no change was made: cancelled, or failed. Removing
 * or keeping an entry gone upstream at the chosen version is a change made.
 */
export interface ChangeVersionResult {
	changed: boolean;
	/** The key the entry is recorded under now: the one it moved to, if it moved. */
	key: string;
	newEntry?: ManifestEntry;
	message: string;
	notes: string[];
}

// Cap the visible version list so a repo with hundreds of tags scrolls within a
// fixed window instead of flooding the terminal. clack's select does the
// scrolling — this is just the window height.
const MAX_VISIBLE_VERSIONS = 15;

function stripConstraint(manifestEntry: ManifestEntry): ManifestEntry {
	const { constraint: _, ...rest } = manifestEntry;
	return rest;
}

export async function executeChangeVersionAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<ChangeVersionResult> {
	// Fetching the full tag list is a network round-trip (git ls-remote) — show a
	// spinner so the pause before the version list isn't silent.
	const url = deriveCloneUrlFromKey(key, entry.cloneUrl);
	const spin = ui.spinner();
	spin.start("Fetching available versions...");
	let tags: string[];
	try {
		tags = [...(await fetchRemoteTags(url))].reverse();
	} finally {
		spin.stop("Fetched available versions");
	}

	if (tags.length === 0) {
		return unchanged(key, "No tagged versions available");
	}

	// Newest-first, with the currently-installed tag flagged so the user can see
	// where they are and pick anything above (upgrade) or below (downgrade) it.
	const options = tags.map((tag) => ({
		value: tag,
		label: tag,
		...(tag === entry.ref ? { hint: "current" } : {}),
	}));

	const selectedTag = await ui.select({
		message: "Select a version",
		options,
		maxItems: MAX_VISIBLE_VERSIONS,
	});

	if (selectedTag === null) {
		return unchanged(key, "Cancelled");
	}

	if (selectedTag === entry.ref) {
		return unchanged(key, "Already on this version");
	}

	// Changing version re-installs (nuke + re-copy) and pins to the exact tag
	// (dropping any constraint) — confirm before mutating anything.
	const confirmed = await ui.confirm({
		message: `Change ${key} to ${selectedTag}? This re-installs it at the new version.`,
	});
	if (!confirmed) {
		return unchanged(key, "Cancelled");
	}

	// The change pins the entry to the chosen tag, dropping its constraint, so
	// it reinstalls as the entry it becomes: a recovery re-adds that tag.
	const prepared = await prepareReinstall(key, stripConstraint(entry), scope, {
		manifest,
		newRef: selectedTag,
	});
	if (!prepared.ok) {
		return unchanged(key, prepared.reason);
	}

	const result = await cloneAndReinstall(prepared.options, ui, manifest);

	if (result.status === "gone") {
		const settled = await settleGoneInList(key, entry, manifest, scope, ui);
		return { changed: settled.ok, key, message: settled.message, notes: [] };
	}
	if (isCloneReinstallFailure(result)) {
		return unchanged(
			key,
			failureMessage(result, key, entry, scope.name, selectedTag),
		);
	}

	await writeManifest(
		scope.root,
		recordReinstall(
			manifest,
			key,
			result.key,
			result.manifestEntry,
			result.absorbed,
		),
	);

	return {
		changed: true,
		key: result.key,
		newEntry: result.manifestEntry,
		message: `Changed ${result.key} to ${selectedTag}`,
		notes: result.notes,
	};
}

function unchanged(key: string, message: string): ChangeVersionResult {
	return { changed: false, key, message, notes: [] };
}
