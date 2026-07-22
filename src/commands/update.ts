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
	groupTargetFacets,
	mapReinstallResultToOutcome,
	type PluginOutcome,
	processGroupUpdate,
} from "../update-groups.js";
import {
	formatCheckFailedLine,
	formatCloneFailureLine,
	formatConstrainedNoMatchLine,
	formatGroupHeader,
	formatMemberLine,
	formatNewerTagsLine,
	formatUpToDateLine,
	groupLabel,
	type MemberLine,
	repoOf,
} from "../update-render.js";
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
		// POST-BUMP current: a constrained-update-available run LANDS on
		// checkResult.tag (so the footer agrees with the inline `Updated ... ->
		// <tag>` line, not the stale pre-bump entry.ref); constrained-up-to-date
		// applied no bump, so pre/post coincide at entry.ref. A constrained entry
		// always carries a resolved tag ref, so entry.ref is non-null here.
		const current =
			checkResult.status === "constrained-update-available"
				? checkResult.tag
				: entry.ref!;
		return {
			key,
			current,
			latestOverall: checkResult.latestOverall,
			// The BARE owner/repo for the re-add command — strip any /<member>
			// segment so a collection member's command re-adds the collection.
			repo: key.split("/").slice(0, 2).join("/"),
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
				// Old ref = pre-update entry.ref; new ref = post-update
				// result.manifestEntry.ref (the resolved result.tag for a constrained
				// update; unchanged entry.ref for a branch/HEAD update). The shared
				// formatVersionMove decides tags-vs-hashes from these.
				oldRef: entry.ref,
				newRef: result.manifestEntry.ref,
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
		// This path now only handles local entries (streamLocalWork), whose outcome
		// is the ref-free `refreshed` (local-update) summary — the git-update arm's
		// newRef is never consulted here, so the pre-update entry.ref is passed as a
		// benign, correct value.
		return mapReinstallResultToOutcome(key, entry, result, entry.ref);
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

/**
 * One group's non-actioned members plus the shared resolved target it was
 * categorized against — the source for the trailing per-group collapse (task
 * 2-5). A group appears here only when it has ≥1 non-actioned member; a group can
 * appear in BOTH {@link CategorizedGroups.updatableGroups} and here (the
 * genuine-state split: behind members stream, up-to-date members collapse). The
 * `target` carries the group-level fields the collapse needs — `newerTags` (tag),
 * `reason` (check-failed) — while `group` carries the version intent + label.
 */
interface NonActionedGroup {
	group: EntryGroup;
	target: GroupTarget;
	outcomes: PluginOutcome[];
}

interface CategorizedGroups {
	updatableGroups: UpdatableGroup[];
	nonActionedGroups: NonActionedGroup[];
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

	// Actioned work STREAMS inline in manifest (processing) order (task 2-4):
	// each updatable group opens its own `Updating <label> …` spinner, clones
	// once (task 1-4), persists its manifest (task 1-6) BEFORE showing any line,
	// then emits its per-member outcome lines (task 2-3); each local group-of-one
	// reinstalls without a spinner and emits its single line. The initial
	// manifest is threaded through so each per-group write is cumulative (matching
	// disk at group boundaries). Only NON-actioned categories now defer to the
	// trailing summary loop below.
	const work = orderWork(categorized.updatableGroups, localEntries, entries);
	const outcomes = await streamActionedWork(work, projectDir, manifest, groups);

	const allUpToDate =
		!categorized.hasNotableCategory && localEntries.length === 0;
	if (allUpToDate) {
		p.outro("All plugins are up to date.");
		renderOutOfConstraintOutput(categorized.outOfConstraintInfo);
		return;
	}

	// Trailing non-actioned summaries collapse to at most ONE line per group per
	// category (task 2-5), iterated in manifest (group) order: an up-to-date count,
	// a per-group newer-tags notice + repo-level add command, a shared check-failed
	// reason, or a shared constrained-no-match constraint — never one line per
	// member. The flat outcomes still feed exit accounting; none trips
	// hasFailedOutcome, so collapsing the DISPLAY here leaves the exit code
	// unchanged.
	for (const nonActioned of categorized.nonActionedGroups) {
		emitCollapsedGroupSummary(nonActioned, groups);
		outcomes.push(...nonActioned.outcomes);
	}

	renderOutOfConstraintOutput(categorized.outOfConstraintInfo);

	// Partial-success exit: the successful updates have been written and streamed
	// inline. Now, if ANY unit aborted (derive-before-delete, entry left intact)
	// or hard-errored/copy-failed, exit non-zero so the command surfaces the
	// failure — without rolling back the units that did succeed. Each unit stands
	// alone (no collection-level coherence rollback).
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
	const nonActionedGroups: NonActionedGroup[] = [];
	const outOfConstraintInfo: OutOfConstraintInfo[] = [];
	let hasNotableCategory = false;

	for (let i = 0; i < groups.length; i++) {
		const group = groups[i]!;
		const target = targets[i]!;
		const updating: GroupMember[] = [];
		const nonActioned: PluginOutcome[] = [];

		// One out-of-constraint footer info PER GROUP (task 2-7) — an N-member
		// collection collapses to a single line, keyed by the group label; two
		// distinct-intent groups of one repo keep separate @intent lines.
		const groupInfo = groupOutOfConstraintInfo(group, target, groups);
		if (groupInfo !== null) {
			outOfConstraintInfo.push(groupInfo);
		}

		for (const member of group.members) {
			const result = categorizeMember(member.entry, target);

			if (
				result.status !== "up-to-date" &&
				result.status !== "constrained-up-to-date"
			) {
				hasNotableCategory = true;
			}

			const outcome = splitMember(member, result, updating);
			if (outcome !== null) {
				nonActioned.push(outcome);
			}
		}

		if (updating.length > 0) {
			updatableGroups.push({ group, target, updating });
		}
		// A group with non-actioned members feeds the trailing per-group collapse —
		// keyed alongside its shared target so the collapse can read group-level
		// fields (newerTags / reason) without re-resolving.
		if (nonActioned.length > 0) {
			nonActionedGroups.push({ group, target, outcomes: nonActioned });
		}
	}

	return {
		updatableGroups,
		nonActionedGroups,
		outOfConstraintInfo,
		hasNotableCategory,
	};
}

/**
 * The ONE out-of-constraint footer info a constrained group contributes (task
 * 2-7). A group whose shared resolved target carries a non-null `latestOverall`
 * is out of constraint (matching {@link hasOutOfConstraintVersion}: latestOverall
 * !== null iff out of constraint), and collapses to a SINGLE info keyed by its
 * {@link groupLabel} — so an N-member collection yields one footer line, not N,
 * while two distinct-intent groups of one repo keep their own @intent lines.
 * `versionIntent` is the group's constraint (non-null for a constrained target).
 */
function groupOutOfConstraintInfo(
	group: EntryGroup,
	target: GroupTarget,
	groups: EntryGroup[],
): OutOfConstraintInfo | null {
	if (target.kind !== "constrained" || target.latestOverall === null) {
		return null;
	}
	return {
		label: groupLabel(group, groups),
		// POST-BUMP current for every member: the group's resolved
		// best-within-constraint tag (the version this run lands the group on).
		current: target.tag,
		latestOverall: target.latestOverall,
		// The BARE owner/repo re-add command (task 2-1 repoOf) — never the @intent
		// label, even when the line prefix is @intent-disambiguated.
		repo: repoOf(group),
		constraint: group.versionIntent!,
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

type GroupWorkItem = Extract<WorkItem, { kind: "group" }>;

/**
 * Streams the ordered work items sequentially (task 2-4), collecting one
 * {@link PluginOutcome} per member for {@link hasFailedOutcome} while emitting
 * each unit's progress + outcome lines the moment it completes — replacing the
 * old deferred end-of-run render. Each updatable group runs under its own
 * `Updating <label> …` spinner ({@link streamGroupWork}); each local entry
 * reinstalls without a spinner ({@link streamLocalWork}). Per-unit manifest
 * persistence (task 1-6) still happens BEFORE that unit's lines stream, and the
 * working manifest is threaded so each write is cumulative (matching disk at
 * group boundaries).
 */
async function streamActionedWork(
	work: WorkItem[],
	projectDir: string,
	manifest: Manifest,
	groups: EntryGroup[],
): Promise<PluginOutcome[]> {
	const outcomes: PluginOutcome[] = [];
	let workingManifest: Manifest = { ...manifest };
	for (const item of work) {
		const unit =
			item.kind === "group"
				? await streamGroupWork(item, projectDir, workingManifest, groups)
				: await streamLocalWork(item, projectDir, workingManifest);
		outcomes.push(...unit.outcomes);
		workingManifest = unit.manifest;
	}
	return outcomes;
}

/** One streamed unit's per-member outcomes plus the manifest after its write. */
interface StreamedUnit {
	outcomes: PluginOutcome[];
	manifest: Manifest;
}

/**
 * Streams one updatable group: opens a single `p.spinner()` (task 2-2) that spins
 * through {@link processGroupUpdate}'s one clone WITHOUT ticking per member,
 * persists the group's manifest (task 1-6) BEFORE emitting any line (so the ✓ is
 * honest), then renders the outcomes.
 *
 * A group of one collapses to exactly ONE physical line. clack's `spinner.stop()`
 * ALWAYS writes a persistent stop-frame, so a header stop-frame plus a separate
 * `p.log` line would render TWO lines; instead the spinner starts on a bare
 * `Updating <label>` (no `(1 members)`, no move) and its settled stop-frame IS the
 * collapsed outcome ({@link collapsedMemberLine}) — no second line. Two or more
 * updating members keep the counted {@link formatGroupHeader} stop-frame followed
 * by one member line each ({@link streamGroupMemberLines}).
 *
 * A group-fatal clone failure (task 2-6) splits by member count. A group-of-one
 * keeps its single collapsed stop-frame ({@link collapsedMemberLine} at error
 * level → code 2) — an "affects 1 members" enumeration would be redundant with the
 * repo name AND regress the group-of-one collapse. A >=2-member group instead
 * settles its header stop-frame then emits ONE enumerated
 * {@link formatCloneFailureLine} line naming the affected members, in place of the
 * per-member lines — never N identical anonymous lines. Either way the model stays
 * the N `failed` outcomes {@link processGroupUpdate} fanned out (Phase 1 task 1-7),
 * so persistence and exit accounting are untouched.
 */
async function streamGroupWork(
	item: GroupWorkItem,
	projectDir: string,
	workingManifest: Manifest,
	groups: EntryGroup[],
): Promise<StreamedUnit> {
	const { commit: newCommit, displayRef: newRef } = groupTargetFacets(
		item.target,
		item.group,
	);
	const label = groupLabel(item.group, groups);
	const single = item.updating.length === 1;
	const header = single
		? `Updating ${label}`
		: formatGroupHeader({
				label,
				oldCommits: item.updating.map((m) => m.entry.commit!),
				oldRefs: item.updating.map((m) => m.entry.ref),
				newCommit,
				newRef,
			});

	const spin = p.spinner();
	spin.start(header);
	const result = await processGroupUpdate(
		item.group,
		item.updating,
		item.target,
		projectDir,
	);
	const { outcomes } = result;
	const manifest = await persistUnitOutcomes(
		projectDir,
		workingManifest,
		outcomes,
	);

	if (single) {
		const line = collapsedMemberLine(outcomes[0]!);
		spin.stop(line.text, line.level === "error" ? 2 : 0);
	} else if (result.cloneFailed) {
		spin.stop(header);
		const affected = item.updating.map((m) => m.key.split("/").pop()!);
		p.log.error(formatCloneFailureLine(label, affected));
	} else {
		spin.stop(header);
		streamGroupMemberLines(item, outcomes, newCommit, newRef);
	}

	return { outcomes, manifest };
}

/**
 * The single collapsed line a group-of-one renders as its spinner stop-frame —
 * its clack {@link MemberLine} `level` and glyph-free `text`. The level maps to
 * the `spin.stop` code at the call site (`error` → 2, else → 0; clack `stop` has
 * no warn code, so a `no-agents` warn accepts the ◇ glyph — its text already
 * carries "skipped — …"). A success reuses the interim
 * {@link renderUpdateOutcomeSummary} text (full key, any `/member` suffix,
 * matching {@link streamCollapsedOutcome}); the loud failure/skip variants reuse
 * {@link formatMemberLine} at the full member key; a bare `failed` (clone
 * fan-out / defensive throw) rides its inline summary at error level.
 */
function collapsedMemberLine(outcome: PluginOutcome): MemberLine {
	switch (outcome.status) {
		case "updated":
		case "refreshed":
			return { level: "success", text: outcome.summary };
		case "copy-failed":
			return formatMemberLine({
				kind: "copy-failed",
				name: outcome.key,
				recoveryHint: outcome.summary,
			});
		case "aborted":
			return formatMemberLine({
				kind: "aborted",
				name: outcome.key,
				message: outcome.summary,
			});
		case "blocked":
			return formatMemberLine({
				kind: "blocked",
				name: outcome.key,
				message: outcome.summary,
			});
		case "skipped-no-agents":
			return formatMemberLine({ kind: "no-agents", name: outcome.key });
		default:
			return { level: "error", text: outcome.summary };
	}
}

/**
 * Streams one local group-of-one: reinstalls without cloning (task 1-5) and with
 * NO spinner, persists its manifest (task 1-6), then emits its single collapsed
 * line — `<key>: Refreshed from local path` on success, else its
 * {@link formatMemberLine} failure/skip line (name = the full key).
 */
async function streamLocalWork(
	item: Extract<WorkItem, { kind: "local" }>,
	projectDir: string,
	workingManifest: Manifest,
): Promise<StreamedUnit> {
	const outcome = await processUpdateForAll(item.key, item.entry, projectDir);
	const manifest = await persistUnitOutcomes(projectDir, workingManifest, [
		outcome,
	]);
	streamCollapsedOutcome(outcome, { key: item.key, entry: item.entry });
	return { outcomes: [outcome], manifest };
}

/**
 * Collapses a group-of-one (a standalone or a single-updated collection member)
 * or a local entry to a single streamed line: a success reuses the interim
 * {@link renderUpdateOutcomeSummary} text (`<key>: Updated …` / `<key>: Refreshed
 * from local path`, full key preserving any `/member` suffix); a failure/skip
 * renders its {@link formatMemberLine} line with the full member key. No group
 * header and no `(N members)`.
 */
function streamCollapsedOutcome(
	outcome: PluginOutcome,
	member: GroupMember,
): void {
	if (outcome.status === "updated" || outcome.status === "refreshed") {
		p.log.success(outcome.summary);
		return;
	}
	emitMemberLine(outcome, member, outcome.key, null);
}

/**
 * Emits one {@link formatMemberLine} line per attempted member (member order),
 * name = basename, each dispatched at its own severity level. The version move
 * rides each member line only when the group is divergent-old
 * (distinct installed commits > 1) — the header then carried the target only
 * (task 2-2); the shared-old common case leaves the move on the header.
 */
function streamGroupMemberLines(
	item: GroupWorkItem,
	outcomes: PluginOutcome[],
	newCommit: string,
	newRef: string | null,
): void {
	const divergent = new Set(item.updating.map((m) => m.entry.commit)).size > 1;
	for (let i = 0; i < outcomes.length; i++) {
		const member = item.updating[i]!;
		const move = divergent
			? {
					oldRef: member.entry.ref,
					newRef,
					oldCommit: member.entry.commit!,
					newCommit,
				}
			: null;
		emitMemberLine(outcomes[i]!, member, member.key.split("/").pop()!, move);
	}
}

/**
 * Maps one member outcome to its {@link formatMemberLine} line and dispatches it
 * via `p.log[level]`. A success carries the effective agents, the dropped-agents
 * notice (derived from the entry vs. the reinstalled agents), and the optional
 * divergent-old `move`; copy-failed/aborted/blocked/no-agents ride their inline
 * message (the pre-built summary IS the message/hint). A `failed` outcome — now
 * only a per-member defensive throw or a per-member subpath-traversal reject, the
 * GROUP-FATAL clone fan-out being intercepted upstream by {@link streamGroupWork}
 * as one enumerated line (task 2-6) — has no member-line kind, so it falls back to
 * the interim summary render at its severity level.
 */
function emitMemberLine(
	outcome: PluginOutcome,
	member: GroupMember,
	name: string,
	move: {
		oldRef: string | null;
		newRef: string | null;
		oldCommit: string;
		newCommit: string;
	} | null,
): void {
	let line: MemberLine;
	switch (outcome.status) {
		case "updated":
		case "refreshed":
			line = formatMemberLine({
				kind: "success",
				name,
				agents: outcome.newEntry.agents,
				droppedAgents: droppedAgentsFor(member.entry, outcome.newEntry),
				move,
			});
			break;
		case "copy-failed":
			line = formatMemberLine({
				kind: "copy-failed",
				name,
				recoveryHint: outcome.summary,
			});
			break;
		case "aborted":
			line = formatMemberLine({
				kind: "aborted",
				name,
				message: outcome.summary,
			});
			break;
		case "blocked":
			line = formatMemberLine({
				kind: "blocked",
				name,
				message: outcome.summary,
			});
			break;
		case "skipped-no-agents":
			line = formatMemberLine({ kind: "no-agents", name });
			break;
		default:
			renderOutcomeSummary(outcome);
			return;
	}
	p.log[line.level](line.text);
}

/**
 * The agents dropped by this reinstall: those the entry was installed for that
 * the reinstalled entry no longer carries. A reinstall only ever narrows the
 * recorded agents (the new config can drop, never add), so this set-difference
 * equals the pipeline's own `droppedAgents` — recomputed here because the
 * {@link PluginOutcome} carries only the pre-rendered summary.
 */
function droppedAgentsFor(
	oldEntry: ManifestEntry,
	newEntry: ManifestEntry,
): string[] {
	return oldEntry.agents.filter((agent) => !newEntry.agents.includes(agent));
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

/**
 * Emits a group's trailing non-actioned summary as ONE collapsed line per
 * category (task 2-5), dispatched on the shared target kind:
 *
 * - `check-failed` → the group's single shared probe reason (all-mode warns, exit
 *   0), count-collapsed — never one line per member.
 * - `constrained-no-match` → the group's single shared constraint (warn),
 *   count-collapsed. `versionIntent` is the constraint (non-null: a
 *   constrained-no-match target only arises for a constrained entry).
 * - `tag` with newer tags → the pinned-ref notice + repo-level add command
 *   (info), one per group (every exact-pin member shares the notice). `newestTag`
 *   is the newest of the shared newer-tags list (reverse-newest); `pinnedRef` is
 *   the group's version intent (non-null: a tag group keys on its ref).
 * - otherwise (constrained / branch / head / tag-with-no-newer) → the up-to-date
 *   count (message). These are the members that did NOT stream under the header
 *   (the genuine-state split); the count excludes any behind sibling that updated.
 */
function emitCollapsedGroupSummary(
	nonActioned: NonActionedGroup,
	groups: EntryGroup[],
): void {
	const { group, target, outcomes } = nonActioned;
	const label = groupLabel(group, groups);

	if (target.kind === "check-failed") {
		p.log.warn(formatCheckFailedLine(label, target.reason));
		return;
	}
	if (target.kind === "constrained-no-match") {
		p.log.warn(formatConstrainedNoMatchLine(label, group.versionIntent!));
		return;
	}
	if (target.kind === "tag" && target.newerTags.length > 0) {
		const newest = [...target.newerTags].reverse()[0]!;
		p.log.info(
			formatNewerTagsLine(label, repoOf(group), group.versionIntent!, newest),
		);
		return;
	}

	const upToDate = outcomes.filter(
		(outcome) => outcome.status === "up-to-date",
	).length;
	if (upToDate > 0) {
		p.log.message(formatUpToDateLine(label, upToDate));
	}
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
