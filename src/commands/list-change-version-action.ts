import * as p from "@clack/prompts";
import { buildFailureMessage, cloneAndReinstall } from "../clone-reinstall.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, writeManifest } from "../manifest.js";
import type { UpdateCheckResult } from "../update-check.js";

export interface ChangeVersionResult {
	changed: boolean;
	newEntry?: ManifestEntry;
	message: string;
}

export async function executeChangeVersionAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	updateStatus: UpdateCheckResult,
): Promise<ChangeVersionResult> {
	if (updateStatus.status !== "newer-tags") {
		return { changed: false, message: "No tags available for version change" };
	}

	const tags = [...updateStatus.tags].reverse();

	const options = tags.map((tag) => ({
		value: tag,
		label: tag,
	}));

	const selected = await p.select({
		message: "Select a version",
		options,
	});

	if (p.isCancel(selected)) {
		return { changed: false, message: "Cancelled" };
	}

	const selectedTag = selected as string;

	if (selectedTag === entry.ref) {
		return { changed: false, message: "Already on this version" };
	}

	const result = await cloneAndReinstall({
		key,
		entry,
		projectDir,
		newRef: selectedTag,
		manifest,
	});

	if (result.status === "failed") {
		const message = buildFailureMessage(result, key, {
			isChangeVersion: true,
		});
		return { changed: false, message };
	}

	const updated = addEntry(manifest, key, result.manifestEntry);
	await writeManifest(projectDir, updated);

	return {
		changed: true,
		newEntry: result.manifestEntry,
		message: `Changed ${key} to ${selectedTag}`,
	};
}
