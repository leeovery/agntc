import {
	cloneAndReinstall,
	failureMessage,
	isCloneReinstallFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { fetchRemoteTags } from "../git-utils.js";
import { settleGoneInList } from "../gone-upstream.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, removeEntry, writeManifest } from "../manifest.js";
import { deriveCloneUrlFromKey } from "../source-parser.js";
import type { Ui } from "../ui.js";

/**
 * `changed` is false when no change was made: cancelled, or failed. Removing
 * or keeping an entry gone upstream at the chosen version is a change made.
 */
export interface ChangeVersionResult {
	changed: boolean;
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
	projectDir: string,
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
		return unchanged("No tagged versions available");
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
		return unchanged("Cancelled");
	}

	if (selectedTag === entry.ref) {
		return unchanged("Already on this version");
	}

	// Changing version re-installs (nuke + re-copy) and pins to the exact tag
	// (dropping any constraint) — confirm before mutating anything.
	const confirmed = await ui.confirm({
		message: `Change ${key} to ${selectedTag}? This re-installs it at the new version.`,
	});
	if (!confirmed) {
		return unchanged("Cancelled");
	}

	const prepared = await prepareReinstall(key, entry, projectDir, {
		manifest,
		newRef: selectedTag,
	});
	if (!prepared.ok) {
		return unchanged(`Path ${key} does not exist or is not a directory`);
	}

	const result = await cloneAndReinstall(prepared.options, ui, manifest);

	if (result.status === "gone") {
		const settled = await settleGoneInList(
			key,
			entry,
			manifest,
			projectDir,
			ui,
		);
		return { changed: true, message: settled.message, notes: [] };
	}
	if (isCloneReinstallFailure(result)) {
		return unchanged(failureMessage(result, key, entry));
	}

	const finalEntry = stripConstraint(result.manifestEntry);
	const rest = result.absorbed.reduce(removeEntry, manifest);
	await writeManifest(projectDir, addEntry(rest, key, finalEntry));

	return {
		changed: true,
		newEntry: finalEntry,
		message: `Changed ${key} to ${selectedTag}`,
		notes: result.notes,
	};
}

function unchanged(message: string): ChangeVersionResult {
	return { changed: false, message, notes: [] };
}
