import { Command } from "commander";
import {
	buildAbortMessage,
	buildCopySafetyMessage,
	type CloneReinstallFailure,
	cloneAndReinstall,
	isCloneReinstallFailure,
	mapCloneFailure,
	prepareReinstall,
} from "../clone-reinstall.js";
import { commandAction, jsonOption } from "../command-action.js";
import { updateBody } from "../documents.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import {
	addEntry,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import { memberName, repoFromKey } from "../source-parser.js";
import {
	type OutOfConstraintInfo,
	renderGitUpdateSummary,
	renderLocalUpdateSummary,
	renderOutOfConstraintSection,
} from "../summary.js";
import { interactiveUi, type Ui } from "../ui.js";
import type { GroupTarget, UpdateCheckResult } from "../update-check.js";
import {
	categorizeMember,
	checkForUpdate,
	hasOutOfConstraintVersion,
	resolveGroupTarget,
} from "../update-check.js";
import {
	type EntryGroup,
	failedOutcome,
	groupEntriesForUpdate,
	groupTargetFacets,
	isSuccessOutcome,
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
	newestTag,
	type VersionOverrides,
} from "../version-resolve.js";

/** One key's update in single-key mode: what became of it and what its check found. */
interface KeyUpdate {
	outcome: PluginOutcome;
	check: UpdateCheckResult;
	outOfConstraint: OutOfConstraintInfo | null;
}

/**
 * The statuses that end a single-key update non-zero: all-mode's failures,
 * plus the check failures all-mode only warns about.
 */
const KEY_FAILURES = new Set<PluginOutcome["status"]>([
	"failed",
	"copy-failed",
	"aborted",
	"blocked",
	"check-failed",
	"constrained-no-match",
]);

export async function runUpdate(
	key?: string,
	ui: Ui = interactiveUi,
): Promise<void> {
	ui.intro("agntc update");

	if (key === undefined) {
		await runAllUpdates(ui);
		return;
	}
	await runKeyUpdates(key, ui);
}

/**
 * Updates the entries a key names one at a time, stopping at the first that
 * fails. Whatever changed before then is recorded.
 */
async function runKeyUpdates(key: string, ui: Ui): Promise<void> {
	const projectDir = process.cwd();

	const manifest = await readManifestOrExit(projectDir, ui);

	if (Object.keys(manifest).length === 0) {
		ui.outro("No plugins installed.");
		ui.report(updateBody(manifest, [], new Map()));
		return;
	}

	const updates: KeyUpdate[] = [];
	for (const targetKey of resolveTargetKeys(key, manifest, ui)) {
		const update = await updateKey(
			targetKey,
			manifest[targetKey]!,
			projectDir,
			ui,
		);
		updates.push(update);
		if (KEY_FAILURES.has(update.outcome.status)) {
			break;
		}
	}

	const outcomes = updates.map((update) => update.outcome);
	await persistUnitOutcomes(projectDir, manifest, outcomes);

	const failed = outcomes.some((outcome) => KEY_FAILURES.has(outcome.status));
	if (!failed) {
		renderOutOfConstraintOutput(
			updates.flatMap((update) => update.outOfConstraint ?? []),
			ui,
		);
	}
	const checks = new Map(
		updates.map((update) => [update.outcome.key, update.check]),
	);
	ui.report(updateBody(manifest, outcomes, checks));
	if (failed) {
		throw new ExitSignal(1);
	}
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
			repo: repoFromKey(key),
		};
	}
	return null;
}

async function updateKey(
	key: string,
	entry: ManifestEntry,
	projectDir: string,
	ui: Ui,
): Promise<KeyUpdate> {
	const check = await checkForUpdate(key, entry);
	return {
		outcome: await settleKey(key, entry, check, projectDir, ui),
		check,
		outOfConstraint: extractOutOfConstraint(key, entry, check),
	};
}

async function settleKey(
	key: string,
	entry: ManifestEntry,
	check: UpdateCheckResult,
	projectDir: string,
	ui: Ui,
): Promise<PluginOutcome> {
	switch (check.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return reportUpToDate(key, ui);
		case "check-failed":
			ui.log.error(`Update check failed for ${key}: ${check.reason}`);
			return { status: "check-failed", key };
		case "newer-tags":
			reportNewerTags(key, entry, check.tags, ui);
			return { status: "newer-tags", key };
		case "constrained-no-match":
			ui.log.error(
				`No tags satisfy the constraint for ${key}. Plugin left untouched.`,
			);
			return { status: "constrained-no-match", key };
		case "constrained-update-available":
			if (isAtOrAboveVersion(entry.ref, check.tag)) {
				return reportUpToDate(key, ui);
			}
			return reinstallKey(key, entry, projectDir, ui, {
				newRef: check.tag,
				newCommit: check.commit,
			});
		case "update-available":
		case "local":
			return reinstallKey(key, entry, projectDir, ui);
	}
}

function reportUpToDate(key: string, ui: Ui): PluginOutcome {
	ui.outro(`${key} is already up to date.`);
	return upToDateOutcome(key);
}

function reportNewerTags(
	key: string,
	entry: ManifestEntry,
	tags: string[],
	ui: Ui,
): void {
	ui.log.info(`Pinned to ${entry.ref}. Newer tags available:`);
	for (const tag of [...tags].reverse()) {
		ui.log.message(`  ${tag}`);
	}
	ui.outro(`To upgrade: npx agntc add ${key}@${newestTag(tags)}`);
}

async function reinstallKey(
	key: string,
	entry: ManifestEntry,
	projectDir: string,
	ui: Ui,
	overrides?: VersionOverrides,
): Promise<PluginOutcome> {
	const prepared = await prepareReinstall(key, entry, projectDir, overrides);
	if (!prepared.ok) {
		ui.log.error(`Path ${key} does not exist or is not a directory.`);
		return failedOutcome(key, prepared.reason);
	}

	const result = await cloneAndReinstall(prepared.options, ui);
	if (isCloneReinstallFailure(result)) {
		reportKeyFailure(key, entry, result, ui);
		return mapReinstallResultToOutcome(key, entry, result, null);
	}

	if (result.note !== undefined) {
		ui.note(result.note);
	}
	ui.outro(
		entry.commit === null
			? renderLocalUpdateSummary({ key, copiedFiles: result.copiedFiles })
			: renderGitUpdateSummary({
					key,
					oldRef: entry.ref,
					newRef: result.manifestEntry.ref,
					oldCommit: entry.commit,
					newCommit: result.manifestEntry.commit!,
					copiedFiles: result.copiedFiles,
				}),
	);
	return mapReinstallResultToOutcome(
		key,
		entry,
		result,
		result.manifestEntry.ref,
	);
}

/**
 * An abort or a block leaves the install intact and says why; a copy failure
 * has already removed it. A local entry's clone failure is its source path
 * failing the containment guard, and says nothing more.
 */
function reportKeyFailure(
	key: string,
	entry: ManifestEntry,
	failure: CloneReinstallFailure,
	ui: Ui,
): void {
	const cancelUnlessLocal = (message: string) => {
		if (entry.commit !== null) {
			ui.cancel(message);
		}
	};
	mapCloneFailure<void>(failure, {
		onCopyFailed: (message) => ui.log.error(message),
		onAborted: (recordedType, reason) =>
			ui.log.error(buildAbortMessage(key, recordedType, reason)),
		onBlocked: (reason) => ui.log.error(buildCopySafetyMessage(key, reason)),
		onCloneFailed: cancelUnlessLocal,
		onUnknown: cancelUnlessLocal,
	});
}

// --- All-plugins mode helpers ---

type GroupMember = { key: string; entry: ManifestEntry };

async function processLocalUpdate(
	key: string,
	entry: ManifestEntry,
	projectDir: string,
	ui: Ui,
): Promise<PluginOutcome> {
	try {
		const prepared = await prepareReinstall(key, entry, projectDir);
		if (!prepared.ok) {
			return failedOutcome(key, prepared.reason);
		}

		const result = await cloneAndReinstall(prepared.options, ui);
		// A local entry (`commit === null`) always takes the ref-free `refreshed`
		// (local-update) arm, which never consults `newRef`.
		return mapReinstallResultToOutcome(key, entry, result, null);
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
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
	/** Each grouped member's own check result, by key. */
	checks: Map<string, UpdateCheckResult>;
	/**
	 * True when any grouped member's RAW category (pre never-downgrade) is not
	 * (constrained-)up-to-date. Gates the all-up-to-date early return exactly as
	 * the pre-dedup category counts did, so a never-downgraded member still routes
	 * through the per-unit summary rather than the clean "all up to date" outro.
	 */
	hasNotableCategory: boolean;
}

async function runAllUpdates(ui: Ui): Promise<void> {
	const projectDir = process.cwd();

	const manifest = await readManifestOrExit(projectDir, ui);

	const entries = Object.entries(manifest);

	if (entries.length === 0) {
		ui.outro("No plugins installed.");
		ui.report(updateBody(manifest, [], new Map()));
		return;
	}

	const groups = groupEntriesForUpdate(manifest);
	const localEntries = entries.filter(([, entry]) => entry.commit === null);

	const spin = ui.spinner();
	spin.start("Checking for updates...");
	const targets = await Promise.all(groups.map(resolveGroupTarget));
	spin.stop("Update checks complete.");

	const categorized = categorizeGroups(groups, targets);

	// Actioned work streams in manifest order as each unit lands; only the
	// non-actioned categories wait for the trailing summary.
	const work = orderWork(categorized.updatableGroups, localEntries, entries);
	const actioned = await streamActionedWork(
		work,
		projectDir,
		manifest,
		groups,
		ui,
	);

	const allUpToDate =
		!categorized.hasNotableCategory && localEntries.length === 0;
	if (allUpToDate) {
		ui.outro("All plugins are up to date.");
	} else {
		for (const nonActioned of categorized.nonActionedGroups) {
			emitCollapsedGroupSummary(nonActioned, groups, ui);
		}
	}
	renderOutOfConstraintOutput(categorized.outOfConstraintInfo, ui);

	const outcomes = [
		...actioned,
		...categorized.nonActionedGroups.flatMap((group) => group.outcomes),
	];
	ui.report(
		updateBody(
			manifest,
			inManifestOrder(outcomes, manifest),
			categorized.checks,
		),
	);

	// Units that succeeded stay written; any that aborted or failed make the
	// run exit non-zero without rolling them back.
	if (hasFailedOutcome(outcomes)) {
		throw new ExitSignal(1);
	}
}

function inManifestOrder(
	outcomes: PluginOutcome[],
	manifest: Manifest,
): PluginOutcome[] {
	const position = new Map(Object.keys(manifest).map((key, i) => [key, i]));
	return [...outcomes].sort(
		(a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0),
	);
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
	const checks = new Map<string, UpdateCheckResult>();
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
			checks.set(member.key, result);

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
		checks,
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
		case "newer-tags":
			return { status: "newer-tags", key };
		case "check-failed":
			return { status: "check-failed", key };
		case "constrained-no-match":
			return { status: "constrained-no-match", key };
		case "local":
			// Unreachable: local entries are excluded from grouping entirely.
			return null;
	}
}

function upToDateOutcome(key: string): PluginOutcome {
	return { status: "up-to-date", key };
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
	ui: Ui,
): Promise<PluginOutcome[]> {
	const outcomes: PluginOutcome[] = [];
	let workingManifest: Manifest = { ...manifest };
	for (const item of work) {
		const unit =
			item.kind === "group"
				? await streamGroupWork(item, projectDir, workingManifest, groups, ui)
				: await streamLocalWork(item, projectDir, workingManifest, ui);
		reportNotes(unit.outcomes, ui);
		outcomes.push(...unit.outcomes);
		workingManifest = unit.manifest;
	}
	return outcomes;
}

function reportNotes(outcomes: PluginOutcome[], ui: Ui): void {
	for (const outcome of outcomes) {
		if (isSuccessOutcome(outcome) && outcome.note !== undefined) {
			ui.note(outcome.note);
		}
	}
}

/** One streamed unit's per-member outcomes plus the manifest after its write. */
interface StreamedUnit {
	outcomes: PluginOutcome[];
	manifest: Manifest;
}

/**
 * Streams one updatable group: opens a single `ui.spinner()` that spins
 * through {@link processGroupUpdate}'s one clone WITHOUT ticking per member,
 * persists the group's manifest BEFORE emitting any line (so the ✓ is
 * honest), then renders the outcomes.
 *
 * A group of one collapses to exactly ONE physical line. clack's `spinner.stop()`
 * ALWAYS writes a persistent stop-frame, so a header stop-frame plus a separate
 * `ui.log` line would render TWO lines; instead the spinner starts on a bare
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
	ui: Ui,
): Promise<StreamedUnit> {
	const { commit: newCommit, displayRef: newRef } = groupTargetFacets(
		item.target,
		item.group,
	);
	const label = groupLabel(item.group, groups);
	const single = item.updating.length === 1;
	// The group's ONE divergent-old property, computed here from the installed
	// commits and threaded to BOTH rendering surfaces (header + member lines) so
	// the header-move / member-move XOR has a single source and cannot drift.
	const divergent = new Set(item.updating.map((m) => m.entry.commit)).size > 1;
	const header = single
		? `Updating ${label}`
		: formatGroupHeader({
				label,
				oldCommits: item.updating.map((m) => m.entry.commit!),
				oldRefs: item.updating.map((m) => m.entry.ref),
				newCommit,
				newRef,
				divergent,
			});

	const spin = ui.spinner();
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
		const affected = item.updating.map((m) => memberName(m.key));
		ui.log.error(formatCloneFailureLine(label, affected));
	} else {
		spin.stop(header);
		streamGroupMemberLines(item, outcomes, newCommit, newRef, divergent, ui);
	}

	return { outcomes, manifest };
}

/**
 * The ONE outcome→{@link MemberLine} mapping shared by the collapsed group-of-one
 * path ({@link collapsedMemberLine}) and the streamed multi-member path
 * ({@link emitMemberLine}) for the loud statuses that render IDENTICALLY on
 * both — copy-failed / aborted / blocked. Each rides its already-assembled
 * summary/hint through {@link formatMemberLine}, so a new such status is a
 * single-site change here and the two paths cannot drift apart.
 *
 * `name` is a PARAMETER so each caller keeps its own name source: the collapsed
 * path passes the FULL member key (`outcome.key`); the streamed path passes the
 * member basename.
 *
 * Returns `null` for a bare `failed` (and any other non-loud status): that
 * fallback is deliberately NOT shared, because the two paths reach red by
 * different mechanics and no single {@link MemberLine} can reproduce both — the
 * collapsed path settles a red error spinner stop-frame (`level: "error"` →
 * `spin.stop` code 2), while the streamed path emits `ui.log.error` via
 * {@link renderFailedOutcome}. Both render `failed` at ERROR (red ✗) — uniform
 * severity across layouts — so each caller keeps its own bare-`failed` rendering.
 */
export function failureMemberLine(
	outcome: PluginOutcome,
	name: string,
): MemberLine | null {
	switch (outcome.status) {
		case "copy-failed":
			return formatMemberLine({
				kind: "copy-failed",
				name,
				recoveryHint: outcome.summary,
			});
		case "aborted":
			return formatMemberLine({
				kind: "aborted",
				name,
				message: outcome.summary,
			});
		case "blocked":
			return formatMemberLine({
				kind: "blocked",
				name,
				message: outcome.summary,
			});
		default:
			return null;
	}
}

/**
 * The single collapsed line a group-of-one renders as its spinner stop-frame —
 * its clack {@link MemberLine} `level` and glyph-free `text`. The level maps to
 * the `spin.stop` code at the call site (`error` → 2, else → 0). A success
 * reuses the interim {@link renderUpdateOutcomeSummary} text (full key, any
 * `/member` suffix, matching {@link streamCollapsedOutcome}); the loud failure
 * variants defer to the shared {@link failureMemberLine} at the full member
 * key; a bare
 * `failed` (clone fan-out / defensive throw) is not a shared-format status (the
 * helper returns null) and rides its inline summary at error level.
 */
function collapsedMemberLine(outcome: PluginOutcome): MemberLine {
	if (isSuccessOutcome(outcome)) {
		return { level: "success", text: outcome.summary };
	}
	return (
		failureMemberLine(outcome, outcome.key) ?? {
			level: "error",
			// A bare `failed` (clone fan-out / defensive throw) is the sole
			// non-shared-format status that reaches this fallback; the non-actioned
			// categories route to emitCollapsedGroupSummary and never arrive here.
			text: outcome.status === "failed" ? outcome.summary : outcome.key,
		}
	);
}

/**
 * Streams one local group-of-one: reinstalls without cloning (task 1-5) and with
 * NO spinner, persists its manifest (task 1-6), then emits its single collapsed
 * line — `<key>: Refreshed from local path` on success, else its
 * {@link formatMemberLine} failure line (name = the full key).
 */
async function streamLocalWork(
	item: Extract<WorkItem, { kind: "local" }>,
	projectDir: string,
	workingManifest: Manifest,
	ui: Ui,
): Promise<StreamedUnit> {
	const outcome = await processLocalUpdate(
		item.key,
		item.entry,
		projectDir,
		ui,
	);
	const manifest = await persistUnitOutcomes(projectDir, workingManifest, [
		outcome,
	]);
	streamCollapsedOutcome(outcome, ui);
	return { outcomes: [outcome], manifest };
}

/**
 * Collapses a group-of-one (a standalone or a single-updated collection member)
 * or a local entry to a single streamed line: a success reuses the interim
 * {@link renderUpdateOutcomeSummary} text (`<key>: Updated …` / `<key>: Refreshed
 * from local path`, full key preserving any `/member` suffix); a failure
 * renders its {@link formatMemberLine} line with the full member key. No group
 * header and no `(N members)`.
 */
function streamCollapsedOutcome(outcome: PluginOutcome, ui: Ui): void {
	if (isSuccessOutcome(outcome)) {
		ui.log.success(outcome.summary);
		return;
	}
	emitMemberLine(outcome, outcome.key, null, ui);
}

/**
 * Emits one {@link formatMemberLine} line per attempted member (member order),
 * name = basename, each dispatched at its own severity level. The version move
 * rides each member line only when the group is divergent-old — the header then
 * carried the target only; the shared-old common case leaves the move
 * on the header. The divergent-old decision is NOT derived here: the caller
 * ({@link streamGroupWork}) computes it ONCE and supplies it as `divergent`, the
 * same boolean it threads into {@link formatGroupHeader}, so the header-move /
 * member-move XOR is a single source of truth and cannot drift.
 */
export function streamGroupMemberLines(
	item: GroupWorkItem,
	outcomes: PluginOutcome[],
	newCommit: string,
	newRef: string | null,
	divergent: boolean,
	ui: Ui,
): void {
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
		emitMemberLine(outcomes[i]!, memberName(member.key), move, ui);
	}
}

/**
 * Maps one member outcome to its {@link formatMemberLine} line and dispatches it
 * via `ui.log[level]`. A success renders the member name plus the optional
 * divergent-old `move`; the loud variants (copy-failed/aborted/blocked) defer to
 * the shared {@link failureMemberLine} at the member basename — the same
 * rendering the collapsed path uses. A `failed` outcome — now only a per-member defensive throw
 * or a per-member subpath-traversal reject, the GROUP-FATAL clone fan-out being
 * intercepted upstream by {@link streamGroupWork} as one enumerated line (task
 * 2-6) — is not a shared-format status (the helper returns null), so it falls
 * back to the {@link renderFailedOutcome} render at ERROR (red ✗) — uniform with
 * the collapsed group-of-one stop-frame.
 */
function emitMemberLine(
	outcome: PluginOutcome,
	name: string,
	move: {
		oldRef: string | null;
		newRef: string | null;
		oldCommit: string;
		newCommit: string;
	} | null,
	ui: Ui,
): void {
	if (isSuccessOutcome(outcome)) {
		const line = formatMemberLine({ kind: "success", name, move });
		ui.log[line.level](line.text);
		return;
	}

	const line = failureMemberLine(outcome, name);
	if (line === null) {
		renderFailedOutcome(outcome, ui);
		return;
	}
	ui.log[line.level](line.text);
}

/**
 * Folds ONE unit's (group or local) outcomes into the working manifest and
 * writes it — the per-group / per-local persistence boundary (task 1-6).
 * Applies today's VERBATIM remove-vs-intact rules: updated/refreshed add their
 * new entry; copy-failed removes its entry (its old files are already gone);
 * everything else — aborted / blocked / non-actioned check
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
		if (isSuccessOutcome(outcome)) {
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
 *   is the newest of the shared newer-tags list (via `newestTag` — the tail of
 *   the ascending list); `pinnedRef` is
 *   the group's version intent (non-null: a tag group keys on its ref).
 * - otherwise (constrained / branch / head / tag-with-no-newer) → the up-to-date
 *   count (message). These are the members that did NOT stream under the header
 *   (the genuine-state split); the count excludes any behind sibling that updated.
 */
function emitCollapsedGroupSummary(
	nonActioned: NonActionedGroup,
	groups: EntryGroup[],
	ui: Ui,
): void {
	const { group, target, outcomes } = nonActioned;
	const label = groupLabel(group, groups);

	if (target.kind === "check-failed") {
		ui.log.warn(formatCheckFailedLine(label, target.reason));
		return;
	}
	if (target.kind === "constrained-no-match") {
		ui.log.warn(formatConstrainedNoMatchLine(label, group.versionIntent!));
		return;
	}
	if (target.kind === "tag" && target.newerTags.length > 0) {
		const newest = newestTag(target.newerTags);
		ui.log.info(
			formatNewerTagsLine(label, repoOf(group), group.versionIntent!, newest),
		);
		return;
	}

	const upToDate = outcomes.filter(
		(outcome) => outcome.status === "up-to-date",
	).length;
	if (upToDate > 0) {
		ui.log.message(formatUpToDateLine(label, upToDate));
	}
}

/**
 * Renders the {@link emitMemberLine} bare-`failed` fallback at ERROR (red ✗) —
 * the sole outcome that reaches this path (success is handled upstream, and every
 * loud variant renders via {@link failureMemberLine}). Any other status
 * is unreachable here and intentionally a no-op.
 */
function renderFailedOutcome(outcome: PluginOutcome, ui: Ui): void {
	if (outcome.status === "failed") {
		ui.log.error(outcome.summary);
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

function renderOutOfConstraintOutput(
	infos: OutOfConstraintInfo[],
	ui: Ui,
): void {
	for (const line of renderOutOfConstraintSection(infos)) {
		ui.log.info(line);
	}
}

export const updateCommand = new Command("update")
	.description("Update installed plugins")
	.argument("[key]", "Plugin key to update (owner/repo or owner/repo/plugin)")
	.addOption(jsonOption())
	.action(
		commandAction("update", (ui, key: string | undefined) =>
			runUpdate(key, ui),
		),
	);
