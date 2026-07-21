import * as p from "@clack/prompts";
import { Command } from "commander";
import {
	buildAbortMessage,
	buildCopySafetyMessage,
	cloneAndReinstall,
	isCloneReinstallFailure,
	mapCloneFailure,
	noAgentsMessage,
	prepareReinstall,
} from "../clone-reinstall.js";
import { errorMessage } from "../errors.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import {
	addEntry,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import {
	type OutOfConstraintInfo,
	renderGitUpdateSummary,
	renderLocalUpdateSummary,
	renderOutOfConstraintSection,
} from "../summary.js";
import type { UpdateCheckResult } from "../update-check.js";
import { checkForUpdate, hasOutOfConstraintVersion } from "../update-check.js";
import {
	mapReinstallResultToOutcome,
	type PluginOutcome,
} from "../update-groups.js";
import {
	isAtOrAboveVersion,
	type VersionOverrides,
} from "../version-resolve.js";

interface SingleUpdateResult {
	newEntry: ManifestEntry | null;
	outOfConstraint: OutOfConstraintInfo | null;
}

export async function runUpdate(key?: string): Promise<void> {
	p.intro("agntc update");

	if (key === undefined) {
		await runAllUpdates();
		return;
	}

	const projectDir = process.cwd();

	const manifest = await readManifestOrExit(projectDir);

	if (Object.keys(manifest).length === 0) {
		p.outro("No plugins installed.");
		return;
	}

	const targetKeys = resolveTargetKeys(key, manifest);

	let updatedManifest = { ...manifest };
	let hasChanges = false;
	const outOfConstraintInfos: OutOfConstraintInfo[] = [];

	for (const targetKey of targetKeys) {
		const entry = manifest[targetKey]!;
		const result = await runSingleUpdate(
			targetKey,
			entry,
			manifest,
			projectDir,
		);
		if (result.newEntry !== null) {
			updatedManifest = addEntry(updatedManifest, targetKey, result.newEntry);
			hasChanges = true;
		}
		if (result.outOfConstraint !== null) {
			outOfConstraintInfos.push(result.outOfConstraint);
		}
	}

	if (hasChanges) {
		await writeManifest(projectDir, updatedManifest);
	}

	renderOutOfConstraintOutput(outOfConstraintInfos);
}

function extractOutOfConstraint(
	key: string,
	entry: ManifestEntry,
	checkResult: UpdateCheckResult,
): OutOfConstraintInfo | null {
	if (
		hasOutOfConstraintVersion(checkResult) &&
		entry.constraint !== undefined
	) {
		return {
			key,
			latestOverall: checkResult.latestOverall,
			constraint: entry.constraint,
		};
	}
	return null;
}

async function runSingleUpdate(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
): Promise<SingleUpdateResult> {
	// Check for update
	const result = await checkForUpdate(key, entry);
	const outOfConstraint = extractOutOfConstraint(key, entry, result);

	if (result.status === "up-to-date") {
		p.outro(`${key} is already up to date.`);
		return { newEntry: null, outOfConstraint };
	}

	if (result.status === "check-failed") {
		p.log.error(`Update check failed for ${key}: ${result.reason}`);
		throw new ExitSignal(1);
	}

	if (result.status === "newer-tags") {
		p.log.info(`Pinned to ${entry.ref}. Newer tags available:`);
		const reversed = [...result.tags].reverse();
		for (const tag of reversed) {
			p.log.message(`  ${tag}`);
		}
		const newest = reversed[0]!;
		p.outro(`To upgrade: npx agntc add ${key}@${newest}`);
		return { newEntry: null, outOfConstraint };
	}

	if (result.status === "constrained-up-to-date") {
		p.outro(`${key} is already up to date.`);
		return { newEntry: null, outOfConstraint };
	}

	if (result.status === "constrained-no-match") {
		p.log.error(
			`No tags satisfy the constraint for ${key}. Plugin left untouched.`,
		);
		throw new ExitSignal(1);
	}

	if (result.status === "constrained-update-available") {
		if (isAtOrAboveVersion(entry.ref, result.tag)) {
			p.outro(`${key} is already up to date.`);
			return { newEntry: null, outOfConstraint };
		}
		const newEntry = await runSinglePluginUpdate(
			key,
			entry,
			manifest,
			projectDir,
			{
				newRef: result.tag,
				newCommit: result.commit,
			},
		);
		return { newEntry, outOfConstraint };
	}

	// update-available or local — proceed with single plugin update
	const newEntry = await runSinglePluginUpdate(
		key,
		entry,
		manifest,
		projectDir,
	);
	return { newEntry, outOfConstraint };
}

async function runSinglePluginUpdate(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest,
	projectDir: string,
	overrides?: VersionOverrides,
): Promise<ManifestEntry | null> {
	const isLocal = entry.commit === null;

	const prepared = await prepareReinstall(key, entry, projectDir, {
		manifest,
		...overrides,
	});
	if (!prepared.ok) {
		p.log.error(`Path ${key} does not exist or is not a directory.`);
		throw new ExitSignal(1);
	}

	const result = await cloneAndReinstall(prepared.options);

	if (isCloneReinstallFailure(result)) {
		return mapCloneFailure(result, {
			onNoAgents: () => {
				p.log.warn(
					`${noAgentsMessage(key)}. ` +
						`No update performed. Run npx agntc remove ${key} to clean up.`,
				);
				return null;
			},
			onCopyFailed: (msg) => {
				p.log.error(msg);
				throw new ExitSignal(1);
			},
			onAborted: (recordedType, reason) => {
				// Derive-before-delete abort: install fully intact (no nuke, entry
				// untouched). Loud report names recorded-vs-current + remove+add
				// remedy; single-key update exits non-zero. Distinct from copy-failed
				// (entry removed, currently-uninstalled retry hint).
				p.log.error(buildAbortMessage(key, recordedType, reason));
				throw new ExitSignal(1);
			},
			onBlocked: (reason) => {
				// Symlink-escape copy-safety block: install fully intact (no nuke,
				// entry untouched), same posture as onAborted but a DIFFERENT message —
				// it describes the escaping symlink, NOT a recorded-type change, and
				// offers no remove+add remedy (that re-trips the guard). Single-key
				// update exits non-zero.
				p.log.error(buildCopySafetyMessage(key, reason));
				throw new ExitSignal(1);
			},
			onCloneFailed: (msg) => {
				if (!isLocal) p.cancel(msg);
				throw new ExitSignal(1);
			},
			onUnknown: (msg) => {
				if (!isLocal) p.cancel(msg);
				throw new ExitSignal(1);
			},
		});
	}

	if (isLocal) {
		p.outro(
			renderLocalUpdateSummary({
				key,
				copiedFiles: result.copiedFiles,
				effectiveAgents: result.manifestEntry.agents,
				droppedAgents: result.droppedAgents,
			}),
		);
	} else {
		p.outro(
			renderGitUpdateSummary({
				key,
				oldCommit: entry.commit,
				newCommit: result.manifestEntry.commit!,
				copiedFiles: result.copiedFiles,
				effectiveAgents: result.manifestEntry.agents,
				droppedAgents: result.droppedAgents,
			}),
		);
	}

	return result.manifestEntry;
}

// --- All-plugins mode helpers ---

interface CheckedPlugin {
	key: string;
	entry: ManifestEntry;
	checkResult: UpdateCheckResult;
}

async function processUpdateForAll(
	key: string,
	entry: ManifestEntry,
	projectDir: string,
	overrides?: VersionOverrides,
): Promise<PluginOutcome> {
	try {
		const prepared = await prepareReinstall(key, entry, projectDir, {
			...overrides,
		});
		if (!prepared.ok) {
			return {
				status: "failed",
				key,
				summary: `${key}: Failed — ${prepared.reason}`,
			};
		}

		const result = await cloneAndReinstall(prepared.options);
		return mapReinstallResultToOutcome(key, entry, result);
	} catch (err) {
		return {
			status: "failed",
			key,
			summary: `${key}: Failed — ${errorMessage(err)}`,
		};
	}
}

async function runAllUpdates(): Promise<void> {
	const projectDir = process.cwd();

	const manifest = await readManifestOrExit(projectDir);

	const entries = Object.entries(manifest);

	if (entries.length === 0) {
		p.outro("No plugins installed.");
		return;
	}

	// Parallel update checks with spinner
	const spin = p.spinner();
	spin.start("Checking for updates...");

	const checkResults: CheckedPlugin[] = await Promise.all(
		entries.map(async ([key, entry]) => ({
			key,
			entry,
			checkResult: await checkForUpdate(key, entry),
		})),
	);

	spin.stop("Update checks complete.");

	// Categorize
	const updateAvailable: CheckedPlugin[] = [];
	const local: CheckedPlugin[] = [];
	const newerTags: CheckedPlugin[] = [];
	const upToDate: CheckedPlugin[] = [];
	const checkFailed: CheckedPlugin[] = [];
	const constrainedUpdateAvailable: CheckedPlugin[] = [];
	const constrainedNoMatch: CheckedPlugin[] = [];

	for (const checked of checkResults) {
		switch (checked.checkResult.status) {
			case "update-available":
				updateAvailable.push(checked);
				break;
			case "local":
				local.push(checked);
				break;
			case "newer-tags":
				newerTags.push(checked);
				break;
			case "up-to-date":
				upToDate.push(checked);
				break;
			case "check-failed":
				checkFailed.push(checked);
				break;
			case "constrained-update-available":
				constrainedUpdateAvailable.push(checked);
				break;
			case "constrained-up-to-date":
				upToDate.push(checked);
				break;
			case "constrained-no-match":
				constrainedNoMatch.push(checked);
				break;
		}
	}

	// Collect out-of-constraint info for downstream rendering
	const outOfConstraintInfo: OutOfConstraintInfo[] = [];
	for (const checked of checkResults) {
		const info = extractOutOfConstraint(
			checked.key,
			checked.entry,
			checked.checkResult,
		);
		if (info !== null) {
			outOfConstraintInfo.push(info);
		}
	}

	// Process updatable plugins sequentially, collecting outcomes
	const outcomes: PluginOutcome[] = [];

	for (const checked of [...updateAvailable, ...local]) {
		const outcome = await processUpdateForAll(
			checked.key,
			checked.entry,
			projectDir,
		);
		outcomes.push(outcome);
	}

	// Process constrained-update-available plugins with overrides
	for (const checked of constrainedUpdateAvailable) {
		const result = checked.checkResult;
		if (result.status !== "constrained-update-available") continue;

		// Never downgrade
		if (isAtOrAboveVersion(checked.entry.ref, result.tag)) {
			outcomes.push({
				status: "up-to-date",
				key: checked.key,
				summary: `${checked.key}: Up to date`,
			});
			continue;
		}

		const outcome = await processUpdateForAll(
			checked.key,
			checked.entry,
			projectDir,
			{ newRef: result.tag, newCommit: result.commit },
		);
		outcomes.push(outcome);
	}

	// Build updated manifest with all successful updates and copy-failed removals
	let updatedManifest = { ...manifest };
	let hasChanges = false;

	for (const outcome of outcomes) {
		if (
			(outcome.status === "updated" || outcome.status === "refreshed") &&
			"newEntry" in outcome
		) {
			updatedManifest = addEntry(
				updatedManifest,
				outcome.key,
				outcome.newEntry,
			);
			hasChanges = true;
		} else if (outcome.status === "copy-failed") {
			updatedManifest = removeEntry(updatedManifest, outcome.key);
			hasChanges = true;
		}
	}

	// Single manifest write
	if (hasChanges) {
		await writeManifest(projectDir, updatedManifest);
	}

	// Collect summaries for non-actionable categories
	for (const checked of newerTags) {
		const result = checked.checkResult;
		if (result.status === "newer-tags") {
			const reversed = [...result.tags].reverse();
			const newest = reversed[0]!;
			outcomes.push({
				status: "newer-tags",
				key: checked.key,
				summary: `${checked.key}: Pinned to ${checked.entry.ref} — newer tags available (latest: ${newest})`,
			});
		}
	}

	for (const checked of upToDate) {
		outcomes.push({
			status: "up-to-date",
			key: checked.key,
			summary: `${checked.key}: Up to date`,
		});
	}

	for (const checked of checkFailed) {
		const result = checked.checkResult;
		const reason = result.status === "check-failed" ? result.reason : "unknown";
		outcomes.push({
			status: "check-failed",
			key: checked.key,
			summary: `${checked.key}: Check failed — ${reason}`,
		});
	}

	for (const checked of constrainedNoMatch) {
		outcomes.push({
			status: "constrained-no-match",
			key: checked.key,
			summary: `${checked.key}: No tags satisfy constraint — plugin left untouched`,
		});
	}

	// If everything is up-to-date and nothing else happened
	const allUpToDate =
		updateAvailable.length === 0 &&
		local.length === 0 &&
		checkFailed.length === 0 &&
		newerTags.length === 0 &&
		constrainedUpdateAvailable.length === 0 &&
		constrainedNoMatch.length === 0;

	if (allUpToDate) {
		p.outro("All plugins are up to date.");
		renderOutOfConstraintOutput(outOfConstraintInfo);
		return;
	}

	// Per-plugin summary
	for (const outcome of outcomes) {
		if (outcome.status === "updated" || outcome.status === "refreshed") {
			p.log.success(outcome.summary);
		} else if (
			outcome.status === "copy-failed" ||
			outcome.status === "aborted" ||
			outcome.status === "blocked"
		) {
			p.log.error(outcome.summary);
		} else if (
			outcome.status === "failed" ||
			outcome.status === "check-failed" ||
			outcome.status === "skipped-no-agents" ||
			outcome.status === "constrained-no-match"
		) {
			p.log.warn(outcome.summary);
		} else if (outcome.status === "newer-tags") {
			p.log.info(outcome.summary);
		} else {
			p.log.message(outcome.summary);
		}
	}

	renderOutOfConstraintOutput(outOfConstraintInfo);

	// Partial-success exit: the successful updates have been written and the full
	// per-unit report rendered above. Now, if ANY unit aborted (derive-before-
	// delete, entry left intact) or hard-errored/copy-failed, exit non-zero so the
	// command surfaces the failure — without rolling back the units that did
	// succeed. Each unit stands alone (no collection-level coherence rollback).
	if (hasFailedOutcome(outcomes)) {
		throw new ExitSignal(1);
	}
}

function hasFailedOutcome(outcomes: PluginOutcome[]): boolean {
	return outcomes.some(
		(outcome) =>
			outcome.status === "aborted" ||
			outcome.status === "blocked" ||
			outcome.status === "failed" ||
			outcome.status === "copy-failed",
	);
}

function renderOutOfConstraintOutput(infos: OutOfConstraintInfo[]): void {
	const lines = renderOutOfConstraintSection(infos);
	for (const line of lines) {
		p.log.info(line);
	}
}

export const updateCommand = new Command("update")
	.description("Update installed plugins")
	.argument("[key]", "Plugin key to update (owner/repo or owner/repo/plugin)")
	.action(
		withExitSignal(async (key?: string) => {
			await runUpdate(key);
		}),
	);
