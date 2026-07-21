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
import type { GroupTarget, UpdateCheckResult } from "../update-check.js";
import {
	categorizeMember,
	checkForUpdate,
	hasOutOfConstraintVersion,
	resolveGroupTarget,
} from "../update-check.js";
import {
	type EntryGroup,
	groupEntriesForUpdate,
	mapReinstallResultToOutcome,
	type PluginOutcome,
	processGroupUpdate,
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

type GroupMember = { key: string; entry: ManifestEntry };

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

/** A group's updating subset plus the shared resolved target it clones at. */
interface UpdatableGroup {
	group: EntryGroup;
	target: GroupTarget;
	updating: GroupMember[];
}

/**
 * One unit of actioned work in manifest (processing) order: an updatable group
 * (clones once, reinstalls its updating members) or a local entry (a
 * group-of-one that never clones). `position` is the manifest index of the
 * unit's representative key, so groups and locals interleave deterministically.
 */
type WorkItem =
	| ({ kind: "group"; position: number } & UpdatableGroup)
	| { kind: "local"; position: number; key: string; entry: ManifestEntry };

interface CategorizedGroups {
	updatableGroups: UpdatableGroup[];
	nonActionedOutcomes: PluginOutcome[];
	outOfConstraintInfo: OutOfConstraintInfo[];
	/**
	 * True when any grouped member's RAW category (pre never-downgrade) is not
	 * (constrained-)up-to-date. Gates the all-up-to-date early return exactly as
	 * the pre-dedup category counts did, so a never-downgraded member still routes
	 * through the per-unit summary rather than the clean "all up to date" outro.
	 */
	hasNotableCategory: boolean;
}

async function runAllUpdates(): Promise<void> {
	const projectDir = process.cwd();

	const manifest = await readManifestOrExit(projectDir);

	const entries = Object.entries(manifest);

	if (entries.length === 0) {
		p.outro("No plugins installed.");
		return;
	}

	// Group-first pipeline: partition non-local entries into clone-dedup groups
	// (task 1-1); local entries never clone and are handled as groups-of-one.
	const groups = groupEntriesForUpdate(manifest);
	const localEntries = entries.filter(([, entry]) => entry.commit === null);

	// Resolve/check ONCE per group (task 1-3) — in parallel across distinct repos,
	// under the single leading spinner — replacing the old per-member checks.
	const spin = p.spinner();
	spin.start("Checking for updates...");
	const targets = await Promise.all(groups.map(resolveGroupTarget));
	spin.stop("Update checks complete.");

	const categorized = categorizeGroups(groups, targets);

	// Actioned work streams in manifest order: each updatable group clones once
	// (task 1-4); each local reinstalls without cloning. (The DESIGNED
	// two-granularity progress stream is Phase 2 — output here stays interim.)
	// Per-group manifest persistence (task 1-6): each updatable group and each
	// local group-of-one writes the manifest once, right after its reinstall
	// loop — so a checkmark is honest (persisted before shown, once Phase 2
	// streams it) and an interrupt leaves the manifest matching disk at group
	// boundaries (early groups recorded, later ones untouched). The initial
	// manifest is threaded through so each write is cumulative.
	const work = orderWork(categorized.updatableGroups, localEntries, entries);
	const outcomes = await processWorkItems(work, projectDir, manifest);

	// Trailing non-actioned summaries (up-to-date / newer-tags / check-failed /
	// constrained-no-match), fed to the same summary loop + exit accounting.
	outcomes.push(...categorized.nonActionedOutcomes);

	const allUpToDate =
		!categorized.hasNotableCategory && localEntries.length === 0;
	if (allUpToDate) {
		p.outro("All plugins are up to date.");
		renderOutOfConstraintOutput(categorized.outOfConstraintInfo);
		return;
	}

	for (const outcome of outcomes) {
		renderOutcomeSummary(outcome);
	}

	renderOutOfConstraintOutput(categorized.outOfConstraintInfo);

	// Partial-success exit: the successful updates have been written and the full
	// per-unit report rendered above. Now, if ANY unit aborted (derive-before-
	// delete, entry left intact) or hard-errored/copy-failed, exit non-zero so the
	// command surfaces the failure — without rolling back the units that did
	// succeed. Each unit stands alone (no collection-level coherence rollback).
	if (hasFailedOutcome(outcomes)) {
		throw new ExitSignal(1);
	}
}

/**
 * Categorizes every group's members against its shared resolved target, splitting
 * each group into its updating subset and per-member non-actioned outcomes, and
 * collecting out-of-constraint info along the way.
 */
function categorizeGroups(
	groups: EntryGroup[],
	targets: GroupTarget[],
): CategorizedGroups {
	const updatableGroups: UpdatableGroup[] = [];
	const nonActionedOutcomes: PluginOutcome[] = [];
	const outOfConstraintInfo: OutOfConstraintInfo[] = [];
	let hasNotableCategory = false;

	for (let i = 0; i < groups.length; i++) {
		const group = groups[i]!;
		const target = targets[i]!;
		const updating: GroupMember[] = [];

		for (const member of group.members) {
			const result = categorizeMember(member.entry, target);

			const info = extractOutOfConstraint(member.key, member.entry, result);
			if (info !== null) {
				outOfConstraintInfo.push(info);
			}

			if (
				result.status !== "up-to-date" &&
				result.status !== "constrained-up-to-date"
			) {
				hasNotableCategory = true;
			}

			const nonActioned = splitMember(member, result, updating);
			if (nonActioned !== null) {
				nonActionedOutcomes.push(nonActioned);
			}
		}

		if (updating.length > 0) {
			updatableGroups.push({ group, target, updating });
		}
	}

	return {
		updatableGroups,
		nonActionedOutcomes,
		outOfConstraintInfo,
		hasNotableCategory,
	};
}

/**
 * Routes a categorized member to either the group's updating subset (pushed onto
 * `updating`, reinstalled from the shared clone) or a trailing non-actioned
 * outcome (returned). Honours the never-downgrade guard for constrained members:
 * an update-available member already at/above the resolved tag is demoted to
 * up-to-date and never clones (update.ts's `isAtOrAboveVersion`).
 */
function splitMember(
	member: GroupMember,
	result: UpdateCheckResult,
	updating: GroupMember[],
): PluginOutcome | null {
	const { key, entry } = member;
	switch (result.status) {
		case "update-available":
			updating.push(member);
			return null;
		case "constrained-update-available":
			if (isAtOrAboveVersion(entry.ref, result.tag)) {
				return upToDateOutcome(key);
			}
			updating.push(member);
			return null;
		case "up-to-date":
		case "constrained-up-to-date":
			return upToDateOutcome(key);
		case "newer-tags": {
			const newest = [...result.tags].reverse()[0]!;
			return {
				status: "newer-tags",
				key,
				summary: `${key}: Pinned to ${entry.ref} — newer tags available (latest: ${newest})`,
			};
		}
		case "check-failed":
			return {
				status: "check-failed",
				key,
				summary: `${key}: Check failed — ${result.reason}`,
			};
		case "constrained-no-match":
			return {
				status: "constrained-no-match",
				key,
				summary: `${key}: No tags satisfy constraint — plugin left untouched`,
			};
		case "local":
			// Unreachable: local entries are excluded from grouping entirely.
			return null;
	}
}

function upToDateOutcome(key: string): PluginOutcome {
	return { status: "up-to-date", key, summary: `${key}: Up to date` };
}

/**
 * Interleaves updatable groups and local group-of-ones into a single list in
 * manifest (processing) order — each unit keyed by the manifest index of its
 * representative key, so the actioned stream is deterministic.
 */
function orderWork(
	updatableGroups: UpdatableGroup[],
	localEntries: Array<[string, ManifestEntry]>,
	entries: Array<[string, ManifestEntry]>,
): WorkItem[] {
	const position = new Map(
		entries.map(([key], i): [string, number] => [key, i]),
	);
	const work: WorkItem[] = [];
	for (const ug of updatableGroups) {
		work.push({
			kind: "group",
			position: position.get(ug.group.members[0]!.key)!,
			...ug,
		});
	}
	for (const [key, entry] of localEntries) {
		work.push({ kind: "local", position: position.get(key)!, key, entry });
	}
	work.sort((a, b) => a.position - b.position);
	return work;
}

/**
 * Processes the ordered work items sequentially, collecting one
 * {@link PluginOutcome} per member AND persisting the manifest per unit
 * (task 1-6). A group clones once via {@link processGroupUpdate}; a local entry
 * reinstalls without cloning via {@link processUpdateForAll}. After each unit's
 * reinstall loop its outcomes are folded into the working manifest and written
 * (see {@link persistUnitOutcomes}) — one write per updatable group / local,
 * skipping no-op units. The working manifest is threaded so each write reflects
 * all prior units (matching disk at group boundaries); the returned outcomes
 * still drive {@link hasFailedOutcome}.
 */
async function processWorkItems(
	work: WorkItem[],
	projectDir: string,
	manifest: Manifest,
): Promise<PluginOutcome[]> {
	const outcomes: PluginOutcome[] = [];
	let workingManifest: Manifest = { ...manifest };
	for (const item of work) {
		const unitOutcomes =
			item.kind === "group"
				? await runUpdatableGroup(item, projectDir)
				: [await processUpdateForAll(item.key, item.entry, projectDir)];
		outcomes.push(...unitOutcomes);
		workingManifest = await persistUnitOutcomes(
			projectDir,
			workingManifest,
			unitOutcomes,
		);
	}
	return outcomes;
}

/**
 * Runs one updatable group's clone-once orchestration, mapping a group-fatal
 * clone failure to N `failed` outcomes attributed per key. `cloneRepoOnce` has
 * already retried 3× internally, so a throw here is final: no entries are
 * removed (only copy-failed removes), and the N failures trip the non-zero exit
 * — matching today's per-entry clone-failed accounting.
 */
async function runUpdatableGroup(
	item: UpdatableGroup,
	projectDir: string,
): Promise<PluginOutcome[]> {
	try {
		return await processGroupUpdate(
			item.group,
			item.updating,
			item.target,
			projectDir,
		);
	} catch (err) {
		const message = errorMessage(err);
		return item.updating.map((member) => ({
			status: "failed",
			key: member.key,
			summary: `${member.key}: Failed — ${message}`,
		}));
	}
}

/**
 * Folds ONE unit's (group or local) outcomes into the working manifest and
 * writes it — the per-group / per-local persistence boundary (task 1-6).
 * Applies today's VERBATIM remove-vs-intact rules: updated/refreshed add their
 * new entry; copy-failed removes its entry (its old files are already gone);
 * everything else — aborted / blocked / no-agents / non-actioned check
 * categories — leaves the manifest untouched. The write is SKIPPED for a no-op
 * unit (no add/remove mutation). Returns the (possibly-updated) manifest so the
 * caller threads it into the next unit, keeping each write cumulative.
 */
async function persistUnitOutcomes(
	projectDir: string,
	manifest: Manifest,
	outcomes: PluginOutcome[],
): Promise<Manifest> {
	let updatedManifest = manifest;
	let mutated = false;

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
			mutated = true;
		} else if (outcome.status === "copy-failed") {
			updatedManifest = removeEntry(updatedManifest, outcome.key);
			mutated = true;
		}
	}

	if (mutated) {
		await writeManifest(projectDir, updatedManifest);
	}

	return updatedManifest;
}

/** Renders one outcome to the per-unit summary at the log level for its status. */
function renderOutcomeSummary(outcome: PluginOutcome): void {
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
