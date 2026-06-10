import * as p from "@clack/prompts";
import {
	cloneAndReinstall,
	failureMessage,
	isCloneReinstallFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { fetchRemoteTags } from "../git-utils.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, writeManifest } from "../manifest.js";
import { deriveCloneUrlFromKey } from "../source-parser.js";

export interface ChangeVersionResult {
	changed: boolean;
	newEntry?: ManifestEntry;
	message: string;
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
): Promise<ChangeVersionResult> {
	// Fetching the full tag list is a network round-trip (git ls-remote) — show a
	// spinner so the pause before the version list isn't silent.
	const url = deriveCloneUrlFromKey(key, entry.cloneUrl);
	const spin = p.spinner();
	spin.start("Fetching available versions...");
	let tags: string[];
	try {
		tags = [...(await fetchRemoteTags(url))].reverse();
	} finally {
		spin.stop("Fetched available versions");
	}

	if (tags.length === 0) {
		return { changed: false, message: "No tagged versions available" };
	}

	// Newest-first, with the currently-installed tag flagged so the user can see
	// where they are and pick anything above (upgrade) or below (downgrade) it.
	const options = tags.map((tag) => ({
		value: tag,
		label: tag,
		...(tag === entry.ref ? { hint: "current" } : {}),
	}));

	const selected = await p.select({
		message: "Select a version",
		options,
		maxItems: MAX_VISIBLE_VERSIONS,
	});

	if (p.isCancel(selected)) {
		return { changed: false, message: "Cancelled" };
	}

	const selectedTag = selected as string;

	if (selectedTag === entry.ref) {
		return { changed: false, message: "Already on this version" };
	}

	// Changing version re-installs (nuke + re-copy) and pins to the exact tag
	// (dropping any constraint) — confirm before mutating anything.
	const confirmed = await p.confirm({
		message: `Change ${key} to ${selectedTag}? This re-installs it at the new version.`,
	});
	if (p.isCancel(confirmed) || !confirmed) {
		return { changed: false, message: "Cancelled" };
	}

	const prepared = await prepareReinstall(key, entry, projectDir, {
		manifest,
		newRef: selectedTag,
	});
	if (!prepared.ok) {
		return {
			changed: false,
			message: `Path ${key} does not exist or is not a directory`,
		};
	}

	const result = await cloneAndReinstall(prepared.options);

	if (isCloneReinstallFailure(result)) {
		return { changed: false, message: failureMessage(result, key) };
	}

	const finalEntry = stripConstraint(result.manifestEntry);
	const updated = addEntry(manifest, key, finalEntry);
	await writeManifest(projectDir, updated);

	return {
		changed: true,
		newEntry: finalEntry,
		message: `Changed ${key} to ${selectedTag}`,
	};
}
