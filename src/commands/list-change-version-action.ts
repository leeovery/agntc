import * as p from "@clack/prompts";
import {
	buildAbortMessage,
	cloneAndReinstall,
	mapCloneFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { fetchRemoteTags } from "../git-utils.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { addEntry, writeManifest } from "../manifest.js";
import { deriveCloneUrlFromKey } from "../source-parser.js";
import type { UpdateCheckResult } from "../update-check.js";

export interface ChangeVersionResult {
	changed: boolean;
	newEntry?: ManifestEntry;
	message: string;
}

type ChangeVersionStatus = Extract<
	UpdateCheckResult,
	| { status: "newer-tags" }
	| { status: "constrained-update-available" }
	| { status: "constrained-up-to-date" }
>;

function isChangeVersionStatus(
	status: UpdateCheckResult,
): status is ChangeVersionStatus {
	return (
		status.status === "newer-tags" ||
		status.status === "constrained-update-available" ||
		status.status === "constrained-up-to-date"
	);
}

async function resolveTagsForSelect(
	key: string,
	entry: ManifestEntry,
	updateStatus: ChangeVersionStatus,
): Promise<string[]> {
	if (updateStatus.status === "newer-tags") {
		return [...updateStatus.tags].reverse();
	}

	const url = deriveCloneUrlFromKey(key, entry.cloneUrl);
	const remoteTags = await fetchRemoteTags(url);
	return [...remoteTags].reverse();
}

function stripConstraint(manifestEntry: ManifestEntry): ManifestEntry {
	const { constraint: _, ...rest } = manifestEntry;
	return rest;
}

export async function executeChangeVersionAction(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	updateStatus: UpdateCheckResult,
): Promise<ChangeVersionResult> {
	if (!isChangeVersionStatus(updateStatus)) {
		return { changed: false, message: "No tags available for version change" };
	}

	const tags = await resolveTagsForSelect(key, entry, updateStatus);

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

	if (
		result.status === "failed" ||
		result.status === "aborted" ||
		result.status === "no-agents"
	) {
		return mapCloneFailure<ChangeVersionResult>(result, {
			onCloneFailed: (msg) => ({ changed: false, message: msg }),
			onNoAgents: (msg) => ({ changed: false, message: msg }),
			onCopyFailed: (msg) => ({ changed: false, message: msg }),
			onUnknown: (msg) => ({ changed: false, message: msg }),
			// Derive-before-delete abort: full recorded-vs-current message +
			// remove+add remedy via the canonical builder. Install intact.
			onAborted: (recordedType, reason) => ({
				changed: false,
				message: buildAbortMessage(key, recordedType, reason),
			}),
		});
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
