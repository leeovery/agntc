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
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { updateBody } from "../documents.js";
import { groupReAddCommands, reAddCommand } from "../entry-source.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import { settleGone } from "../gone-upstream.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { readManifestOrExit, writeManifest } from "../manifest.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import {
	commandTitle,
	projectScope,
	type Scope,
	type ScopeName,
} from "../scope.js";
import { memberName } from "../source-parser.js";
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
	absorbedBy,
	applyOutcome,
	type EntryGroup,
	failedOutcome,
	type GroupMember,
	groupEntriesForUpdate,
	groupTargetFacets,
	isSuccessOutcome,
	keyBefore,
	mapReinstallResultToOutcome,
	type PluginOutcome,
	packsFirst,
	processGroupUpdate,
	withAbsorptions,
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

/** The statuses that end an update of every entry non-zero. */
const ALL_FAILURES = new Set<PluginOutcome["status"]>([
	"failed",
	"copy-failed",
	"aborted",
	"blocked",
]);

/**
 * The statuses that end an update given a key non-zero: all-mode's failures,
 * plus the check failures all-mode only warns about, since the user named
 * these entries. However many entries the key names, the rule is the same.
 */
const KEY_FAILURES = new Set<PluginOutcome["status"]>([
	...ALL_FAILURES,
	"check-failed",
	"constrained-no-match",
]);

export interface UpdateOptions {
	/** Remove entries gone upstream without asking. */
	yes?: boolean;
}

/** What every step of one update run shares. */
interface UpdateRun {
	scope: Scope;
	yes: boolean;
	ui: Ui;
}

export async function runUpdate(
	key?: string,
	options: UpdateOptions = {},
	ui: Ui = interactiveUi,
	scope: Scope = projectScope(),
): Promise<void> {
	ui.intro(commandTitle("update", scope.name));

	const run: UpdateRun = {
		scope,
		yes: options.yes === true,
		ui,
	};
	const manifest = await readManifestOrExit(scope.root, ui);

	if (Object.keys(manifest).length === 0) {
		ui.outro("No skills or packs installed.");
		ui.report(updateBody(manifest, [], new Map()));
		return;
	}

	if (key === undefined) {
		await runGroupedUpdates(manifest, manifest, ALL_FAILURES, run);
		return;
	}
	const targets = pick(manifest, resolveTargetKeys(key, manifest, ui));
	const [only, ...others] = Object.entries(targets);
	if (only !== undefined && others.length === 0) {
		await runKeyUpdate({ key: only[0], entry: only[1] }, manifest, run);
		return;
	}
	await runGroupedUpdates(manifest, targets, KEY_FAILURES, run);
}

/** The entries of `manifest` recorded under `keys`, in manifest order. */
function pick(manifest: Manifest, keys: string[]): Manifest {
	const wanted = new Set(keys);
	return Object.fromEntries(
		Object.entries(manifest).filter(([key]) => wanted.has(key)),
	);
}

/**
 * Updates the one entry a key names. It is recorded once it finishes, so what
 * changed before a failure stays recorded.
 */
async function runKeyUpdate(
	member: GroupMember,
	manifest: Manifest,
	run: UpdateRun,
): Promise<void> {
	const { scope, ui } = run;
	const update = await updateKey(member, manifest, run);
	await persistUnitOutcomes(scope.root, manifest, [update.outcome]);

	const failed = hasFailedOutcome([update.outcome], KEY_FAILURES);
	if (!failed && update.outOfConstraint !== null) {
		renderOutOfConstraintOutput([update.outOfConstraint], ui);
	}
	const checks = new Map([[keyBefore(update.outcome), update.check]]);
	ui.report(updateBody(manifest, withAbsorptions([update.outcome]), checks));
	if (failed) {
		throw new ExitSignal(1);
	}
}

function extractOutOfConstraint(
	{ key, entry }: GroupMember,
	checkResult: UpdateCheckResult,
	scope: ScopeName,
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
			commands: [reAddCommand(key, entry, scope)],
		};
	}
	return null;
}

async function updateKey(
	member: GroupMember,
	installed: Manifest,
	run: UpdateRun,
): Promise<KeyUpdate> {
	const check = await checkForUpdate(member.key, member.entry);
	const outcome = await settleKey(member, check, installed, run);
	return {
		outcome,
		check,
		outOfConstraint: extractOutOfConstraint(
			memberAfter(member, [outcome]),
			check,
			run.scope.name,
		),
	};
}

/**
 * A member as the run left it: reinstalled, under the key it moved to, so a
 * command printed for it installs onto that entry.
 */
function memberAfter(
	member: GroupMember,
	outcomes: PluginOutcome[],
): GroupMember {
	const reinstalled = outcomes.find(
		(outcome) => keyBefore(outcome) === member.key,
	);
	return reinstalled !== undefined && isSuccessOutcome(reinstalled)
		? { key: reinstalled.key, entry: reinstalled.newEntry }
		: member;
}

async function settleKey(
	member: GroupMember,
	check: UpdateCheckResult,
	installed: Manifest,
	run: UpdateRun,
): Promise<PluginOutcome> {
	const { key, entry } = member;
	const { ui } = run;
	switch (check.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return reportUpToDate(key, ui);
		case "check-failed":
			ui.log.error(`Update check failed for ${key}: ${check.reason}`);
			return { status: "check-failed", key };
		case "newer-tags":
			reportNewerTags(member, check.tags, run);
			return { status: "newer-tags", key };
		case "constrained-no-match":
			ui.log.error(
				`No tags satisfy the constraint for ${key}. Left untouched.`,
			);
			return { status: "constrained-no-match", key };
		case "constrained-update-available":
			if (isAtOrAboveVersion(entry.ref, check.tag)) {
				return reportUpToDate(key, ui);
			}
			return reinstallKey(member, installed, run, {
				newRef: check.tag,
				newCommit: check.commit,
			});
		case "update-available":
		case "local":
			return reinstallKey(member, installed, run);
	}
}

function reportUpToDate(key: string, ui: Ui): PluginOutcome {
	ui.outro(`${key} is already up to date.`);
	return upToDateOutcome(key);
}

function reportNewerTags(
	{ key, entry }: GroupMember,
	tags: string[],
	{ scope, ui }: UpdateRun,
): void {
	ui.log.info(`Pinned to ${entry.ref}. Newer tags available:`);
	for (const tag of [...tags].reverse()) {
		ui.log.message(`  ${tag}`);
	}
	const reAdd = reAddCommand(key, entry, scope.name, newestTag(tags));
	ui.outro(`To upgrade: ${reAdd}`);
}

async function reinstallKey(
	member: GroupMember,
	installed: Manifest,
	run: UpdateRun,
	overrides?: VersionOverrides,
): Promise<PluginOutcome> {
	const { key, entry } = member;
	const { scope, ui } = run;
	const prepared = await prepareReinstall(key, entry, scope, overrides);
	if (!prepared.ok) {
		ui.log.error(prepared.reason);
		return failedOutcome(key, prepared.reason);
	}

	const result = await cloneAndReinstall(prepared.options, ui, installed);
	if (result.status === "gone") {
		const outcome = await settleGoneOutcome(member, run);
		reportSettledGone(outcome, ui);
		return outcome;
	}
	if (isCloneReinstallFailure(result)) {
		reportKeyFailure(key, entry, result, run);
		return mapReinstallResultToOutcome(key, entry, result, null, scope.name);
	}

	for (const note of result.notes) {
		ui.note(note);
	}
	ui.outro(
		entry.commit === null
			? renderLocalUpdateSummary({
					key: result.key,
					copiedFiles: result.copiedFiles,
				})
			: renderGitUpdateSummary({
					key: result.key,
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
		scope.name,
	);
}

/**
 * An abort or a block leaves the install intact and says why; a copy failure
 * has already removed it, and a removal failure leaves what's left of it
 * recorded. A remote clone failure closes the run after the spinner's "Clone
 * failed"; a local entry's is its source path failing the containment guard.
 */
function reportKeyFailure(
	key: string,
	entry: ManifestEntry,
	failure: CloneReinstallFailure,
	{ scope, ui }: UpdateRun,
): void {
	const reportCloneFailed = (message: string) =>
		entry.commit === null
			? ui.log.error(`${key}: ${message}`)
			: ui.cancel(message);
	mapCloneFailure<void>(failure, {
		onCopyFailed: (message) => ui.log.error(message),
		onRemoveFailed: (message) => ui.log.error(`${key}: ${message}`),
		onAborted: (abort) =>
			ui.log.error(buildAbortMessage(key, entry, abort, scope.name)),
		onBlocked: (reason) => ui.log.error(buildCopySafetyMessage(key, reason)),
		onCloneFailed: reportCloneFailed,
	});
}

/**
 * Removes or keeps a member found gone upstream. Gone is never a failure, but
 * a removal that can't delete the member's files is.
 */
async function settleGoneOutcome(
	{ key, entry }: GroupMember,
	{ scope, yes, ui }: UpdateRun,
): Promise<PluginOutcome> {
	try {
		const settled = await settleGone(key, entry, scope, { yes, ui });
		if (settled.removed) {
			return { status: "gone-removed", key, summary: settled.message };
		}
		return {
			status: "gone-kept",
			key,
			summary: settled.message,
			...(settled.flags !== undefined ? { flags: settled.flags } : {}),
		};
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
	}
}

function reportSettledGone(outcome: PluginOutcome, ui: Ui): void {
	if (outcome.status === "gone-removed") {
		ui.log.success(outcome.summary);
	} else if (outcome.status === "gone-kept") {
		ui.log.warn(outcome.summary);
	} else if (outcome.status === "failed") {
		ui.log.error(outcome.summary);
	}
}

// --- All-mode helpers ---

async function processLocalUpdate(
	{ key, entry }: GroupMember,
	installed: Manifest,
	{ scope, ui }: UpdateRun,
): Promise<PluginOutcome> {
	try {
		const prepared = await prepareReinstall(key, entry, scope);
		if (!prepared.ok) {
			return failedOutcome(key, prepared.reason);
		}

		const result = await cloneAndReinstall(prepared.options, ui, installed);
		// A local entry (`commit === null`) always takes the ref-free `refreshed`
		// (local-update) arm, which never consults `newRef`.
		return mapReinstallResultToOutcome(key, entry, result, null, scope.name);
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
 * categorized against — the source for the trailing per-group collapse.
 * A group appears here only when it has ≥1 non-actioned member; a group can
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

/** A group with the target its one resolution probe found. */
interface ResolvedGroup {
	group: EntryGroup;
	target: GroupTarget;
}

interface CategorizedGroups {
	updatableGroups: UpdatableGroup[];
	nonActionedGroups: NonActionedGroup[];
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

/**
 * Updates the `selected` entries of `manifest` group-first: every entry when
 * no key is given, and the entries a key names when it names several. Entries
 * sharing a repo and version intent resolve and clone once; each local entry
 * reinstalls on its own. The whole manifest is threaded and written per unit,
 * so entries outside `selected` stay recorded as they were. The run exits
 * non-zero when any outcome's status is in `failures`.
 */
async function runGroupedUpdates(
	manifest: Manifest,
	selected: Manifest,
	failures: Set<PluginOutcome["status"]>,
	run: UpdateRun,
): Promise<void> {
	const { scope, ui } = run;

	const entries = Object.entries(selected);
	const groups = groupEntriesForUpdate(selected);
	const localEntries = entries.filter(([, entry]) => entry.commit === null);

	const spin = ui.spinner();
	spin.start("Checking for updates...");
	const resolved = await Promise.all(
		groups.map(async (group) => ({
			group,
			target: await resolveGroupTarget(group),
		})),
	);
	spin.stop("Update checks complete.");

	const categorized = categorizeGroups(resolved);

	// Actioned work streams as each unit lands, packs first; only the
	// non-actioned categories wait for the trailing summary.
	const work = orderWork(categorized.updatableGroups, localEntries, entries);
	const actioned = await streamActionedWork(work, manifest, groups, run);

	const outcomes = withAbsorptions([
		...actioned,
		...categorized.nonActionedGroups.flatMap((group) => group.outcomes),
	]);
	const absorbed = new Set(
		outcomes.flatMap((outcome) =>
			outcome.status === "absorbed" ? [outcome.key] : [],
		),
	);

	const allUpToDate =
		!categorized.hasNotableCategory && localEntries.length === 0;
	if (allUpToDate) {
		ui.outro("Everything is up to date.");
	} else {
		for (const nonActioned of categorized.nonActionedGroups) {
			emitCollapsedGroupSummary(
				withoutAbsorbed(nonActioned, absorbed),
				groups,
				run,
			);
		}
	}
	renderOutOfConstraintOutput(
		resolved.flatMap(
			(group) =>
				groupOutOfConstraintInfo(group, groups, outcomes, scope.name) ?? [],
		),
		ui,
	);

	ui.report(
		updateBody(
			manifest,
			inManifestOrder(outcomes, manifest),
			categorized.checks,
		),
	);

	// Units that succeeded stay written; any that aborted or failed make the
	// run exit non-zero without rolling them back.
	if (hasFailedOutcome(outcomes, failures)) {
		throw new ExitSignal(1);
	}
}

/** A pack updated in this run took these members over, so they no longer collapse. */
function withoutAbsorbed(
	nonActioned: NonActionedGroup,
	absorbed: Set<string>,
): NonActionedGroup {
	return {
		...nonActioned,
		outcomes: nonActioned.outcomes.filter(({ key }) => !absorbed.has(key)),
	};
}

function inManifestOrder(
	outcomes: PluginOutcome[],
	manifest: Manifest,
): PluginOutcome[] {
	const position = new Map(Object.keys(manifest).map((key, i) => [key, i]));
	const at = (outcome: PluginOutcome) => position.get(keyBefore(outcome)) ?? 0;
	return [...outcomes].sort((a, b) => at(a) - at(b));
}

/**
 * Categorizes every group's members against its shared resolved target, splitting
 * each group into its updating subset and per-member non-actioned outcomes.
 */
function categorizeGroups(resolved: ResolvedGroup[]): CategorizedGroups {
	const updatableGroups: UpdatableGroup[] = [];
	const nonActionedGroups: NonActionedGroup[] = [];
	const checks = new Map<string, UpdateCheckResult>();
	let hasNotableCategory = false;

	for (const { group, target } of resolved) {
		const updating: GroupMember[] = [];
		const nonActioned: PluginOutcome[] = [];

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
			updatableGroups.push({ group, target, updating: packsFirst(updating) });
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
		checks,
		hasNotableCategory,
	};
}

/**
 * The ONE out-of-constraint footer info a constrained group contributes.
 * A group whose shared resolved target carries a non-null `latestOverall`
 * is out of constraint (matching {@link hasOutOfConstraintVersion}: latestOverall
 * !== null iff out of constraint), and collapses to a SINGLE info keyed by its
 * {@link groupLabel} — so an N-member group yields one footer line, not N,
 * while two distinct-intent groups of one repo keep their own @intent lines.
 * The line carries the group's re-add commands ({@link groupReAddCommands}),
 * for its members as the run's `outcomes` left them.
 */
function groupOutOfConstraintInfo(
	{ group, target }: ResolvedGroup,
	groups: EntryGroup[],
	outcomes: PluginOutcome[],
	scope: ScopeName,
): OutOfConstraintInfo | null {
	if (target.kind !== "constrained" || target.latestOverall === null) {
		return null;
	}
	const members = group.members.map((member) => memberAfter(member, outcomes));
	return {
		label: groupLabel(group, groups),
		// POST-BUMP current for every member: the group's resolved
		// best-within-constraint tag (the version this run lands the group on).
		current: target.tag,
		latestOverall: target.latestOverall,
		commands: groupReAddCommands(members, scope),
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
 * Interleaves updatable groups and local group-of-ones into a single list:
 * every unit holding a pack ahead of those that don't, otherwise in manifest
 * order by the index of each unit's representative key. Packs run first
 * across the whole run, not only within a group, so a loose skill a pack
 * absorbs is skipped wherever its own unit sits, rather than updated and
 * then taken over.
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
	const rank = (item: WorkItem) => (holdsPack(item) ? 0 : 1);
	work.sort((a, b) => rank(a) - rank(b) || a.position - b.position);
	return work;
}

function holdsPack(item: WorkItem): boolean {
	const members = item.kind === "group" ? item.updating : [item];
	return members.some(({ entry }) => entry.type === "pack");
}

type GroupWorkItem = Extract<WorkItem, { kind: "group" }>;

/**
 * Streams the ordered work items sequentially, collecting one
 * {@link PluginOutcome} per member for {@link hasFailedOutcome} while emitting
 * each unit's progress + outcome lines the moment it completes — replacing the
 * old deferred end-of-run render. Each updatable group runs under its own
 * `Updating <label> …` spinner ({@link streamGroupWork}); each local entry
 * reinstalls without a spinner ({@link streamLocalWork}). Per-unit manifest
 * persistence still happens BEFORE that unit's lines stream, and the
 * working manifest is threaded so each write is cumulative (matching disk at
 * group boundaries). A member an earlier unit's pack absorbed is left out,
 * even when that pack moved onto its key, and a unit left with no members
 * doesn't run.
 */
async function streamActionedWork(
	work: WorkItem[],
	manifest: Manifest,
	groups: EntryGroup[],
	run: UpdateRun,
): Promise<PluginOutcome[]> {
	const outcomes: PluginOutcome[] = [];
	let workingManifest: Manifest = { ...manifest };
	for (const item of work) {
		const live = stillInstalled(item, new Set(outcomes.flatMap(absorbedBy)));
		if (live === null) {
			continue;
		}
		const unit =
			live.kind === "group"
				? await streamGroupWork(live, workingManifest, groups, run)
				: await streamLocalWork(live, workingManifest, run);
		reportNotes(unit.outcomes, run.ui);
		outcomes.push(...unit.outcomes);
		workingManifest = unit.manifest;
	}
	return outcomes;
}

/**
 * `item` without the members `takenOver` names. A member not yet reached is
 * still under the key it started with, so a key a pack took over names it,
 * whatever that key holds now.
 */
function stillInstalled(
	item: WorkItem,
	takenOver: Set<string>,
): WorkItem | null {
	if (item.kind === "local") {
		return takenOver.has(item.key) ? null : item;
	}
	const updating = item.updating.filter(({ key }) => !takenOver.has(key));
	return updating.length === 0 ? null : { ...item, updating };
}

function reportNotes(outcomes: PluginOutcome[], ui: Ui): void {
	for (const outcome of outcomes) {
		if (isSuccessOutcome(outcome)) {
			for (const note of outcome.notes) {
				ui.note(note);
			}
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
 * A group-fatal clone failure splits by member count. A group-of-one
 * keeps its single collapsed stop-frame ({@link collapsedMemberLine} at error
 * level → code 2) — an "affects 1 members" enumeration would be redundant with the
 * repo name AND regress the group-of-one collapse. A >=2-member group instead
 * settles its header stop-frame then emits ONE enumerated
 * {@link formatCloneFailureLine} line naming the affected members, in place of the
 * per-member lines — never N identical anonymous lines. Either way the model stays
 * the N `failed` outcomes {@link processGroupUpdate} fanned out,
 * so persistence and exit accounting are untouched.
 *
 * Members found gone upstream get no line under the spinner: once it has
 * stopped, {@link settleGoneMembers} asks about each and reports the answer. A
 * group of one that is gone stops on its header.
 */
async function streamGroupWork(
	item: GroupWorkItem,
	workingManifest: Manifest,
	groups: EntryGroup[],
	run: UpdateRun,
): Promise<StreamedUnit> {
	const { scope, ui } = run;
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
		scope,
		workingManifest,
	);
	const { outcomes } = result;
	const manifest = await persistUnitOutcomes(
		scope.root,
		workingManifest,
		outcomes,
	);

	if (single && outcomes[0]!.status !== "gone-kept") {
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

	return settleGoneMembers(outcomes, item.updating, manifest, run);
}

/**
 * Asks about every member a unit found gone upstream, after its spinner has
 * stopped so no prompt runs under it, then records the removals and reports
 * each answer.
 */
async function settleGoneMembers(
	outcomes: PluginOutcome[],
	members: GroupMember[],
	manifest: Manifest,
	run: UpdateRun,
): Promise<StreamedUnit> {
	const settled: PluginOutcome[] = [];
	for (const outcome of outcomes) {
		const member = members.find(({ key }) => key === outcome.key);
		if (outcome.status !== "gone-kept" || member === undefined) {
			settled.push(outcome);
			continue;
		}
		const answer = await settleGoneOutcome(member, run);
		reportSettledGone(answer, run.ui);
		settled.push(answer);
	}
	const removed = settled.filter(
		(outcome) => outcome.status === "gone-removed",
	);
	return {
		outcomes: settled,
		manifest: await persistUnitOutcomes(run.scope.root, manifest, removed),
	};
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
 * Streams one local group-of-one: reinstalls without cloning and with
 * NO spinner, persists its manifest, then emits its single collapsed
 * line — `<key>: Refreshed from local path` on success, else its
 * {@link formatMemberLine} failure line (name = the full key).
 */
async function streamLocalWork(
	item: Extract<WorkItem, { kind: "local" }>,
	workingManifest: Manifest,
	run: UpdateRun,
): Promise<StreamedUnit> {
	const member = { key: item.key, entry: item.entry };
	const outcome = await processLocalUpdate(member, workingManifest, run);
	const manifest = await persistUnitOutcomes(run.scope.root, workingManifest, [
		outcome,
	]);
	streamCollapsedOutcome(outcome, run.ui);
	return settleGoneMembers([outcome], [member], manifest, run);
}

/**
 * Collapses a group-of-one (a standalone or a single-updated member of a multi-item repo)
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
 * intercepted upstream by {@link streamGroupWork} as one enumerated line — is not a shared-format status (the helper returns null), so it falls
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
 * Folds ONE unit's (group, local or single key) outcomes into the working
 * manifest via {@link applyOutcome} and writes it — the per-unit persistence
 * boundary. The write is SKIPPED for a no-op unit. Returns the
 * (possibly-updated) manifest so the caller threads it into the next unit,
 * keeping each write cumulative.
 */
async function persistUnitOutcomes(
	root: string,
	manifest: Manifest,
	outcomes: PluginOutcome[],
): Promise<Manifest> {
	const updatedManifest = outcomes.reduce(applyOutcome, manifest);
	if (updatedManifest !== manifest) {
		await writeManifest(root, updatedManifest);
	}
	return updatedManifest;
}

/**
 * Emits a group's trailing non-actioned summary as ONE collapsed line per
 * category, dispatched on the shared target kind:
 *
 * - `check-failed` → the group's single shared probe reason (all-mode warns, exit
 *   0), count-collapsed — never one line per member.
 * - `constrained-no-match` → the group's single shared constraint (warn),
 *   count-collapsed. `versionIntent` is the constraint (non-null: a
 *   constrained-no-match target only arises for a constrained entry).
 * - `tag` with newer tags → the pinned-ref notice + the group's re-add commands
 *   at the newest tag (info), one line per group (every exact-pin member shares
 *   the notice). `newestTag` is the newest of the shared newer-tags list (via
 *   `newestTag` — the tail of the ascending list); `pinnedRef` is the group's
 *   version intent (non-null: a tag group keys on its ref).
 * - otherwise (constrained / branch / head / tag-with-no-newer) → the up-to-date
 *   count (message). These are the members that did NOT stream under the header
 *   (the genuine-state split); the count excludes any behind sibling that updated.
 *
 * A group whose every non-actioned member was absorbed says nothing.
 */
function emitCollapsedGroupSummary(
	nonActioned: NonActionedGroup,
	groups: EntryGroup[],
	{ scope, ui }: UpdateRun,
): void {
	const { group, target, outcomes } = nonActioned;
	const label = groupLabel(group, groups);

	if (outcomes.length === 0) {
		return;
	}
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
		const commands = groupReAddCommands(
			group.members.filter((member) =>
				outcomes.some(({ key }) => key === member.key),
			),
			scope.name,
			newest,
		);
		ui.log.info(
			formatNewerTagsLine(label, group.versionIntent!, newest, commands),
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
 * Renders the {@link emitMemberLine} bare-`failed` fallback at ERROR (red ✗)
 * (success is handled upstream, and every loud variant renders via
 * {@link failureMemberLine}). Nothing else renders here: an entry gone
 * upstream is reported once settled, and one a pack absorbed is told by the
 * pack's note.
 */
function renderFailedOutcome(outcome: PluginOutcome, ui: Ui): void {
	if (outcome.status === "failed") {
		ui.log.error(outcome.summary);
	}
}

function hasFailedOutcome(
	outcomes: PluginOutcome[],
	failures: Set<PluginOutcome["status"]>,
): boolean {
	return outcomes.some((outcome) => failures.has(outcome.status));
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
	.description("Update installed skills and packs")
	.argument(
		"[key]",
		"Key to update (owner/repo or owner/repo/<skill or pack path>)",
	)
	.option("-y, --yes", "Remove what's gone upstream without asking")
	.addOption(globalOption())
	.addOption(jsonOption())
	.action(
		commandAction(
			"update",
			(ui, scope, key: string | undefined, options: UpdateOptions) =>
				runUpdate(key, options, ui, scope),
		),
	);
