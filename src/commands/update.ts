import { homedir } from "node:os";
import { Command } from "commander";
import { prepareReinstall, reinstallEntry } from "../clone-reinstall.js";
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { updateBody } from "../documents.js";
import { groupReAddCommands, reAddCommand } from "../entry-source.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import {
	keyHead,
	keyRowProgress,
	localHead,
	REFRESHING,
	type RowProgress,
	reinstallKey,
	type SettledKey,
	settleGoneOutcome,
	type UpdateRun,
	updatePlan,
	updateUnderRow,
	updatingTo,
} from "../key-update.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { readManifestOrExit } from "../manifest.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import { projectScope, type Scope, type ScopeName } from "../scope.js";
import {
	type OutOfConstraintInfo,
	outOfConstraintMessage,
} from "../summary.js";
import { adviceItem } from "../terminal/next.js";
import type { RowHead } from "../terminal/types.js";
import { type Block, interactiveUi, type Ui } from "../ui.js";
import type { GroupTarget, UpdateCheckResult } from "../update-check.js";
import {
	categorizeMember,
	checkForUpdate,
	hasOutOfConstraintVersion,
	resolveGroupTarget,
} from "../update-check.js";
import {
	absorbedBy,
	absorbedOutcome,
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
import { persistUnitOutcomes, reportOutcomes } from "../update-outcomes.js";
import {
	cloneFailedRow,
	type GroupMove,
	groupLabel,
	groupSubject,
	type LeftAlone,
	leftAloneRow,
	localRow,
	type MemberResult,
	newerTagsMessage,
	pinnedTagsMessage,
	reinstalledRow,
	updateTally,
} from "../update-render.js";
import {
	intentMeta,
	isAtOrAboveVersion,
	moveTarget,
	newestTag,
	type VersionMove,
	versionMove,
} from "../version-resolve.js";

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

const NOTHING_INSTALLED = "No skills or packs installed.";
const CHECKING = "checking for updates…";

export interface UpdateOptions {
	/** Remove entries gone upstream without asking. */
	yes?: boolean;
}

export async function runUpdate(
	key?: string,
	options: UpdateOptions = {},
	ui: Ui = interactiveUi(),
	scope: Scope = projectScope(),
): Promise<void> {
	ui.header();

	const run: UpdateRun = {
		scope,
		yes: options.yes === true,
		ui,
		home: homedir(),
	};
	const manifest = await readManifestOrExit(scope.root, ui);

	if (Object.keys(manifest).length === 0) {
		ui.block([{ subject: NOTHING_INSTALLED }]).row({
			status: "unchanged",
			subject: NOTHING_INSTALLED,
		});
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
	const { ui } = run;
	const progress = keyRowProgress(member, run);
	progress.say(member.entry.commit === null ? REFRESHING : CHECKING);
	const check = await checkForUpdate(member.key, member.entry);
	const outcome = await updateUnderRow(progress, manifest, run, () =>
		settleKey(member, check, manifest, progress, run),
	);

	const failed = hasFailedOutcome([outcome], KEY_FAILURES);
	const outOfConstraint = extractOutOfConstraint(
		memberAfter(member, [outcome]),
		check,
		run.scope.name,
	);
	if (!failed && outOfConstraint !== null) {
		queueOutOfConstraint([outOfConstraint], ui);
	}
	const checks = new Map([[keyBefore(outcome), check]]);
	const outcomes = withAbsorptions([outcome]);
	ui.close({ command: "update", counts: updateTally(outcomes) });
	ui.report(updateBody(manifest, outcomes, checks));
	if (failed) {
		throw new ExitSignal(1);
	}
}

function extractOutOfConstraint(
	member: GroupMember | null,
	checkResult: UpdateCheckResult,
	scope: ScopeName,
): OutOfConstraintInfo | null {
	if (member === null) {
		return null;
	}
	const { key, entry } = member;
	if (
		hasOutOfConstraintVersion(checkResult) &&
		entry.constraint !== undefined
	) {
		// POST-BUMP current: a constrained-update-available run LANDS on
		// checkResult.tag (so the item agrees with the row's move, not the
		// stale pre-bump entry.ref); constrained-up-to-date applied no bump, so
		// pre/post coincide at entry.ref. A constrained entry always carries a
		// resolved tag ref, so entry.ref is non-null here.
		const current =
			checkResult.status === "constrained-update-available"
				? checkResult.tag
				: entry.ref!;
		return {
			subject: key,
			current,
			latestOverall: checkResult.latestOverall,
			commands: [reAddCommand(key, entry, scope)],
		};
	}
	return null;
}

/** What leaves an entry no longer installed once the run ends. */
const UNINSTALLED: ReadonlySet<PluginOutcome["status"]> = new Set([
	"absorbed",
	"gone-removed",
	"copy-failed",
]);

/**
 * A member as the run left it: reinstalled, under the key it moved to, so a
 * command printed for it installs onto that entry; null when the run left it
 * uninstalled, which no such command is for.
 */
function memberAfter(
	member: GroupMember,
	outcomes: PluginOutcome[],
): GroupMember | null {
	const outcome = outcomes.find(
		(candidate) => keyBefore(candidate) === member.key,
	);
	if (outcome === undefined) {
		return member;
	}
	if (isSuccessOutcome(outcome)) {
		return { key: outcome.key, entry: outcome.newEntry };
	}
	return UNINSTALLED.has(outcome.status) ? null : member;
}

async function settleKey(
	member: GroupMember,
	check: UpdateCheckResult,
	installed: Manifest,
	progress: RowProgress,
	run: UpdateRun,
): Promise<SettledKey> {
	const { key, entry } = member;
	const leftAlone = (why: LeftAlone, outcome: PluginOutcome): SettledKey => ({
		outcome,
		row: leftAloneRow(keyHead(member, run.home), why, [key]),
	});
	switch (check.status) {
		case "up-to-date":
		case "constrained-up-to-date":
			return leftAlone({ status: "up-to-date" }, upToDateOutcome(key));
		case "check-failed":
			return leftAlone(check, { status: "check-failed", key });
		case "newer-tags":
			queueNewerTags(member, check.tags, run);
			return leftAlone(check, { status: "newer-tags", key });
		case "constrained-no-match":
			return leftAlone(
				{ status: check.status, constraint: entry.constraint! },
				{ status: "constrained-no-match", key },
			);
		case "constrained-update-available":
			if (isAtOrAboveVersion(entry.ref, check.tag)) {
				return leftAlone({ status: "up-to-date" }, upToDateOutcome(key));
			}
			return reinstallKey(
				member,
				installed,
				progress,
				run,
				updatePlan(entry, check),
			);
		case "update-available":
		case "local":
			return reinstallKey(
				member,
				installed,
				progress,
				run,
				updatePlan(entry, check),
			);
	}
}

function queueNewerTags(
	{ key, entry }: GroupMember,
	tags: string[],
	{ scope, ui }: UpdateRun,
): void {
	const reAdd = reAddCommand(key, entry, scope.name, newestTag(tags));
	ui.next(adviceItem(pinnedTagsMessage(key, entry.ref!, tags, reAdd)));
}

// --- All-mode helpers ---

async function processLocalUpdate(
	{ key, entry }: GroupMember,
	installed: Manifest,
	{ scope }: UpdateRun,
): Promise<PluginOutcome> {
	try {
		const prepared = await prepareReinstall(key, entry, scope);
		if (!prepared.ok) {
			return failedOutcome(key, prepared.reason);
		}

		const result = await reinstallEntry(prepared.options, installed);
		// A local entry (`commit === null`) always takes the ref-free `refreshed`
		// (local-update) arm, which never consults `newRef`.
		return mapReinstallResultToOutcome(key, entry, result, null, scope.name);
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
	}
}

/**
 * A group's updating subset plus the shared resolved target it clones at,
 * and the members already up to date, which its row shows beside them.
 */
interface UpdatableGroup {
	group: EntryGroup;
	target: GroupTarget;
	updating: GroupMember[];
	upToDate: PluginOutcome[];
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
 * categorized against. A group appears here only when it has ≥1 non-actioned
 * member; a group can appear in BOTH {@link CategorizedGroups.updatableGroups}
 * and here (the genuine-state split: behind members reinstall, up-to-date
 * members wait). Its row is drawn with its unit's when that runs, and alone
 * at the end when it doesn't. The `target` carries the group-level fields
 * that row needs — `newerTags` (tag), `reason` (check-failed) — while `group`
 * carries the version intent + label.
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
}

/**
 * Updates the `selected` entries of `manifest` group-first: every entry when
 * no key is given, and the entries a key names when it names several. Entries
 * sharing a repo and version intent resolve and clone once; each local entry
 * reinstalls on its own. The whole manifest is threaded and written per unit,
 * so entries outside `selected` stay recorded as they were. The run exits
 * non-zero when any outcome's status is in `failures`.
 *
 * One block holds the run: a row per group and local entry, its columns
 * measured up front from every group, member and local entry selected.
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

	const block = ui.block([
		...groups.map((group) =>
			groupSubject(
				groupHead(group, groups),
				group.members.map(({ key }) => key),
			),
		),
		...localEntries.map(([key]) => localHead(key, run.home)),
	]);
	const resolved = await checkGroups(groups, block);
	const categorized = categorizeGroups(resolved);

	// Actioned work streams as each unit lands, packs first; the groups left
	// alone follow once it has.
	const work = orderWork(categorized.updatableGroups, localEntries, entries);
	const actioned = await streamActionedWork(work, manifest, groups, block, run);

	const outcomes = withAbsorptions([
		...actioned.outcomes,
		...categorized.nonActionedGroups.flatMap((group) => group.outcomes),
	]);
	const absorbed = new Set(
		outcomes.flatMap((outcome) =>
			outcome.status === "absorbed" ? [outcome.key] : [],
		),
	);

	for (const nonActioned of categorized.nonActionedGroups) {
		if (!actioned.drawn.has(nonActioned.group)) {
			drawLeftAlone(withoutAbsorbed(nonActioned, absorbed), groups, block, run);
		}
	}
	queueOutOfConstraint(
		resolved.flatMap(
			(group) =>
				groupOutOfConstraintInfo(group, groups, outcomes, scope.name) ?? [],
		),
		ui,
	);

	ui.close({ command: "update", counts: updateTally(outcomes) });
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

/** Each group's one resolution probe, all at once, under one progress line that clears. */
async function checkGroups(
	groups: EntryGroup[],
	block: Block,
): Promise<ResolvedGroup[]> {
	if (groups.length === 0) {
		return [];
	}
	const checking = block.task({ text: CHECKING });
	const resolved = await Promise.all(
		groups.map(async (group) => ({
			group,
			target: await resolveGroupTarget(group),
		})),
	);
	checking.clear();
	return resolved;
}

function groupHead(group: EntryGroup, groups: EntryGroup[]): RowHead {
	return {
		subject: groupLabel(group, groups),
		meta: intentMeta(group.versionIntent),
	};
}

/** A pack updated in this run took these members over, so they leave its row. */
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

	for (const { group, target } of resolved) {
		const updating: GroupMember[] = [];
		const nonActioned: PluginOutcome[] = [];

		for (const member of group.members) {
			const result = categorizeMember(member.entry, target);
			checks.set(member.key, result);
			const outcome = splitMember(member, result, updating);
			if (outcome !== null) {
				nonActioned.push(outcome);
			}
		}

		if (updating.length > 0) {
			updatableGroups.push({
				group,
				target,
				updating: packsFirst(updating),
				upToDate: nonActioned,
			});
		}
		if (nonActioned.length > 0) {
			nonActionedGroups.push({ group, target, outcomes: nonActioned });
		}
	}

	return { updatableGroups, nonActionedGroups, checks };
}

/**
 * The ONE out-of-constraint item a constrained group contributes.
 * A group whose shared resolved target carries a non-null `latestOverall`
 * is out of constraint (matching {@link hasOutOfConstraintVersion}: latestOverall
 * !== null iff out of constraint), and collapses to a SINGLE info keyed by its
 * {@link groupLabel} — so an N-member group yields one item, not N, while
 * two distinct-intent groups of one repo keep their own @intent items. The
 * item carries the group's re-add commands ({@link groupReAddCommands}), for
 * its members as the run's `outcomes` left them; a group the run left with no
 * member installed has no item.
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
	const members = group.members.flatMap(
		(member) => memberAfter(member, outcomes) ?? [],
	);
	if (members.length === 0) {
		return null;
	}
	return {
		subject: groupLabel(group, groups),
		// POST-BUMP current for every member: the group's resolved
		// best-within-constraint tag (the version this run lands the group on).
		current: target.tag,
		latestOverall: target.latestOverall,
		commands: groupReAddCommands(members, scope),
	};
}

/**
 * Routes a categorized member to either the group's updating subset (pushed onto
 * `updating`, reinstalled from the shared clone) or a non-actioned outcome
 * (returned). Honours the never-downgrade guard for constrained members: an
 * update-available member already at/above the resolved tag is demoted to
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

/** The actioned units' outcomes, and the groups whose rows they drew. */
interface StreamedWork {
	outcomes: PluginOutcome[];
	drawn: Set<EntryGroup>;
}

/**
 * Runs the ordered work items one at a time, collecting one
 * {@link PluginOutcome} per member for {@link hasFailedOutcome}, each unit
 * spinning in its row's place until it settles into that row. Per-unit
 * manifest persistence happens before its row settles, and the working
 * manifest is threaded so each write is cumulative (matching disk at unit
 * boundaries). A member an earlier unit's pack absorbed is left out, even
 * when that pack moved onto its key, and a unit left with no members doesn't
 * run.
 */
async function streamActionedWork(
	work: WorkItem[],
	manifest: Manifest,
	groups: EntryGroup[],
	block: Block,
	run: UpdateRun,
): Promise<StreamedWork> {
	const outcomes: PluginOutcome[] = [];
	const drawn = new Set<EntryGroup>();
	let workingManifest: Manifest = { ...manifest };
	for (const item of work) {
		const takenOver = new Set(outcomes.flatMap(absorbedBy));
		const live = stillInstalled(item, takenOver);
		if (live === null) {
			continue;
		}
		const unit =
			live.kind === "group"
				? await streamGroupWork(live, workingManifest, groups, block, run)
				: await streamLocalWork(live, workingManifest, block, run);
		if (live.kind === "group") {
			drawn.add(live.group);
		}
		outcomes.push(...unit.outcomes);
		workingManifest = unit.manifest;
	}
	return { outcomes, drawn };
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
	const upToDate = item.upToDate.filter(({ key }) => !takenOver.has(key));
	return updating.length === 0 ? null : { ...item, updating, upToDate };
}

/** One streamed unit's per-member outcomes plus the manifest after its write. */
interface StreamedUnit {
	outcomes: PluginOutcome[];
	manifest: Manifest;
}

/**
 * Runs one updatable group under a task in its row's place, saying where it
 * updates to, through {@link processGroupUpdate}'s one clone. Its manifest is
 * written, members found gone upstream are asked about (the task pauses for
 * the question), and its notes and remedies are raised before the task
 * settles into the group's row, so the notes print under it.
 *
 * A clone failure is group-fatal: the row names it and every member it took
 * down, while the model stays the N `failed` outcomes
 * {@link processGroupUpdate} fanned out, so persistence and exit accounting
 * are untouched.
 */
async function streamGroupWork(
	item: GroupWorkItem,
	workingManifest: Manifest,
	groups: EntryGroup[],
	block: Block,
	run: UpdateRun,
): Promise<StreamedUnit> {
	const { scope, ui } = run;
	const facets = groupTargetFacets(item.target, item.group);
	const head = groupHead(item.group, groups);
	const task = block.task({
		...head,
		text: updatingTo(facets.displayRef, facets.commit),
	});
	const result = await processGroupUpdate(
		item.group,
		item.updating,
		item.target,
		scope,
		workingManifest,
	);
	const manifest = await persistUnitOutcomes(
		scope.root,
		workingManifest,
		result.outcomes,
	);
	const unit = await settleGoneMembers(
		result.outcomes,
		item.updating,
		manifest,
		run,
	);
	reportOutcomes(unit.outcomes, ui);
	if (result.cloneFailed) {
		const keys = item.updating.map(({ key }) => key);
		task.settle(cloneFailedRow(head, result.reason, keys));
		return unit;
	}
	const takenOver = new Set(unit.outcomes.flatMap(absorbedBy));
	const upToDate = item.upToDate.filter(({ key }) => !takenOver.has(key));
	task.settle(
		reinstalledRow(head, groupMove(item, facets), [
			...memberResults(item, unit.outcomes, facets),
			...upToDate.map((outcome) => ({ outcome })),
			...takenFromOutside(unit.outcomes),
		]),
	);
	return unit;
}

/**
 * The loose entries a group's packs took over that it didn't reinstall in
 * turn (up to date, or in another group), so each still shows where it went.
 */
function takenFromOutside(outcomes: PluginOutcome[]): MemberResult[] {
	const reinstalledInTurn = new Set(
		outcomes
			.filter(({ status }) => status === "absorbed")
			.map(({ key }) => key),
	);
	return outcomes.flatMap((pack) =>
		absorbedBy(pack)
			.filter((key) => !reinstalledInTurn.has(key))
			.map((key) => ({ outcome: absorbedOutcome(key, pack) })),
	);
}

interface Facets {
	commit: string;
	displayRef: string | null;
}

/** A member's move from where it was installed to where the group lands. */
function memberMove(entry: ManifestEntry, facets: Facets): VersionMove {
	return versionMove({
		oldRef: entry.ref,
		newRef: facets.displayRef,
		oldCommit: entry.commit,
		newCommit: facets.commit,
	});
}

/**
 * The group's move, when its updating members were installed at one commit;
 * else only where it lands, each member carrying its own move.
 */
function groupMove(item: GroupWorkItem, facets: Facets): GroupMove {
	if (isDivergent(item)) {
		return { to: moveTarget(facets.displayRef, facets.commit) };
	}
	return { move: memberMove(item.updating[0]!.entry, facets) };
}

function isDivergent(item: GroupWorkItem): boolean {
	return new Set(item.updating.map(({ entry }) => entry.commit)).size > 1;
}

/** Each updating member's outcome, in member order, with its own move when the group's starts differ. */
function memberResults(
	item: GroupWorkItem,
	outcomes: PluginOutcome[],
	facets: Facets,
): MemberResult[] {
	if (!isDivergent(item)) {
		return outcomes.map((outcome) => ({ outcome }));
	}
	return outcomes.map((outcome) => {
		const member = item.updating.find(({ key }) => key === keyBefore(outcome))!;
		return { outcome, move: memberMove(member.entry, facets) };
	});
}

/**
 * Asks about every member a unit found gone upstream, then records the
 * removals.
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
		settled.push(await settleGoneOutcome(member, run));
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
 * Runs one local group-of-one under a task in its row's place: reinstalls
 * without cloning, writes its manifest, asks about it if it's gone upstream,
 * then settles into its row.
 */
async function streamLocalWork(
	item: Extract<WorkItem, { kind: "local" }>,
	workingManifest: Manifest,
	block: Block,
	run: UpdateRun,
): Promise<StreamedUnit> {
	const member = { key: item.key, entry: item.entry };
	const head = localHead(item.key, run.home);
	const task = block.task({ ...head, text: REFRESHING });
	const outcome = await processLocalUpdate(member, workingManifest, run);
	const manifest = await persistUnitOutcomes(run.scope.root, workingManifest, [
		outcome,
	]);
	const unit = await settleGoneMembers([outcome], [member], manifest, run);
	reportOutcomes(unit.outcomes, run.ui);
	task.settle(localRow(head, { outcome: unit.outcomes[0]! }));
	return unit;
}

/**
 * The row of a group the run left alone, why read off its shared target: the
 * check that failed, the constraint no tag satisfies, a pin with newer tags
 * (whose re-add commands at the newest tag go to Next), or up to date. A
 * group whose every non-actioned member was absorbed has no row.
 */
function drawLeftAlone(
	nonActioned: NonActionedGroup,
	groups: EntryGroup[],
	block: Block,
	{ scope, ui }: UpdateRun,
): void {
	const { group, target, outcomes } = nonActioned;
	if (outcomes.length === 0) {
		return;
	}
	const head = groupHead(group, groups);
	if (target.kind === "tag" && target.newerTags.length > 0) {
		const newest = newestTag(target.newerTags);
		const commands = groupReAddCommands(
			group.members.filter((member) =>
				outcomes.some(({ key }) => key === member.key),
			),
			scope.name,
			newest,
		);
		ui.next(
			adviceItem(
				newerTagsMessage(head.subject, group.versionIntent!, newest, commands),
			),
		);
	}
	block.row(leftAloneRow(head, leftAloneOf(target, group)));
}

function leftAloneOf(target: GroupTarget, group: EntryGroup): LeftAlone {
	switch (target.kind) {
		case "check-failed":
			return { status: "check-failed", reason: target.reason };
		case "constrained-no-match":
			return {
				status: "constrained-no-match",
				constraint: group.versionIntent!,
			};
		case "tag":
			return {
				status: target.newerTags.length > 0 ? "newer-tags" : "up-to-date",
			};
		default:
			return { status: "up-to-date" };
	}
}

function hasFailedOutcome(
	outcomes: PluginOutcome[],
	failures: Set<PluginOutcome["status"]>,
): boolean {
	return outcomes.some((outcome) => failures.has(outcome.status));
}

/** Each newer version outside a constraint, and how to move to it, under Next. */
function queueOutOfConstraint(infos: OutOfConstraintInfo[], ui: Ui): void {
	for (const info of infos) {
		ui.next(adviceItem(outOfConstraintMessage(info)));
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
