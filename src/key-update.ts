import {
	type CloneReinstallResult,
	type PrepareReinstallOpts,
	prepareReinstall,
	reinstallEntry,
} from "./clone-reinstall.js";
import { entryHead, localHead } from "./entry-head.js";
import { errorMessage } from "./errors.js";
import { settleGone } from "./gone-upstream.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import type { Scope } from "./scope.js";
import { repoFromKey } from "./source-parser.js";
import type { BlockSubject, Row, RowHead } from "./terminal/types.js";
import type { Block, BlockTask, Ui } from "./ui.js";
import type { UpdateCheckResult } from "./update-check.js";
import {
	failedOutcome,
	type GroupMember,
	isSuccessOutcome,
	mapReinstallResultToOutcome,
	type PluginOutcome,
	told,
} from "./update-groups.js";
import { persistUnitOutcomes, reportOutcomes } from "./update-outcomes.js";
import {
	cloneFailedRow,
	groupSubject,
	localRow,
	type MemberResult,
	reinstalledRow,
} from "./update-render.js";
import { intentMeta, moveTarget, versionMove } from "./version-resolve.js";

export const REFRESHING = "refreshing…";

/** What every step of one update run shares. */
export interface UpdateRun {
	scope: Scope;
	yes: boolean;
	ui: Ui;
	/** The home folder a local entry's path is shortened against. */
	home: string;
}

/**
 * One key's row: a remote entry under its repo and intent, a local one under
 * its folder. A version change names the tag it pins the entry to, as the
 * intent the entry then tracks.
 */
export function keyHead(
	{ key, entry }: GroupMember,
	home: string,
	version?: string,
): RowHead {
	if (entry.commit === null) {
		return localHead(key, home);
	}
	return {
		subject: repoFromKey(key),
		meta: intentMeta(version ?? entry.constraint ?? entry.ref),
	};
}

function keySubject(member: GroupMember, head: RowHead): BlockSubject {
	return member.entry.commit === null ? head : groupSubject(head, [member.key]);
}

/**
 * A row's place in a block while its step runs: what it says it's doing can
 * change, the step before clearing as the next starts, until it settles.
 */
export interface RowProgress {
	say(text: string): void;
	settle(row: Row): void;
}

/**
 * A key's row, in a block of its own: a remote entry under its repo, a local
 * one under its folder, a version change naming the tag it pins.
 */
export function keyRowProgress(
	member: GroupMember,
	run: UpdateRun,
	version?: string,
): RowProgress {
	const head = keyHead(member, run.home, version);
	return rowProgress(run.ui.block([keySubject(member, head)]), head);
}

function rowProgress(block: Block, head: RowHead): RowProgress {
	let task: BlockTask | undefined;
	return {
		say: (text) => {
			task?.clear();
			task = block.task({ ...head, text });
		},
		settle: (row) => task?.settle(row),
	};
}

/** A key's outcome, and the row it settles into. */
export interface SettledKey {
	outcome: PluginOutcome;
	row: Row;
}

/**
 * Where a remote key moves to, which its row names while it updates and
 * after: a constrained one to its resolved tag; any other to its ref's new
 * commit.
 */
export interface KeyTarget {
	newRef: string | null;
	newCommit: string;
}

/**
 * How a remote key reinstalls: where it's going, and the version a
 * constrained one, or one whose version changes, is cloned and recorded at.
 * Without overrides, the clone takes the recorded ref.
 */
export interface KeyPlan {
	target: KeyTarget;
	overrides?: Pick<PrepareReinstallOpts, "newRef" | "newCommit">;
	/**
	 * The tag a version change pins the entry to: its row names it, and an
	 * abort's remedy changes the version again rather than updating.
	 */
	version?: string;
}

/** A check that found something to reinstall: a newer version, or a local source to refresh from. */
export type UpdatableCheck = Extract<
	UpdateCheckResult,
	{ status: "update-available" | "constrained-update-available" | "local" }
>;

export function isUpdatable(check: UpdateCheckResult): check is UpdatableCheck {
	return (
		check.status === "update-available" ||
		check.status === "constrained-update-available" ||
		check.status === "local"
	);
}

/**
 * How an entry its check found something for reinstalls: a constrained one
 * cloned and recorded at its resolved tag, any other remote one at its ref's
 * new commit; a local one has no plan, as it refreshes from its folder.
 */
export function updatePlan(
	entry: ManifestEntry,
	check: UpdatableCheck,
): KeyPlan | undefined {
	switch (check.status) {
		case "constrained-update-available": {
			const resolved = { newRef: check.tag, newCommit: check.commit };
			return { target: resolved, overrides: resolved };
		}
		case "update-available":
			return { target: { newRef: entry.ref, newCommit: check.remoteCommit } };
		case "local":
			return undefined;
	}
}

/**
 * One key's update under the row its caller opened, as `update <key>` and
 * list's actions run it: `settle` decides what it comes to, the row settles
 * into that, and then its outcome is recorded. A throw reaches the caller:
 * `settle`'s with the row unsettled and the manifest as it was, which a
 * caller carrying on after it settles as {@link failedKey}; the record's with
 * the row saying what reached the disk.
 */
export async function updateUnderRow(
	progress: RowProgress,
	manifest: Manifest,
	run: UpdateRun,
	settle: () => Promise<SettledKey>,
): Promise<PluginOutcome> {
	const settled = await settle();
	progress.settle(settled.row);
	await persistUnitOutcomes(run.scope.root, manifest, [settled.outcome]);
	return settled.outcome;
}

/** A key whose step threw, as failed with what it threw, which records nothing. */
export function failedKey(
	member: GroupMember,
	err: unknown,
	run: UpdateRun,
	plan?: KeyPlan,
): SettledKey {
	const outcome = failedOutcome(member.key, errorMessage(err));
	return { outcome, row: keyRow(member, { outcome }, plan, run) };
}

/** A local key reinstalls with no plan: it refreshes from its folder. */
export async function reinstallKey(
	member: GroupMember,
	installed: Manifest,
	progress: RowProgress,
	run: UpdateRun,
	plan?: KeyPlan,
): Promise<SettledKey> {
	const { key, entry } = member;
	const { scope } = run;
	if (plan !== undefined) {
		progress.say(updatingTo(plan.target.newRef, plan.target.newCommit));
	}
	const prepared = await prepareReinstall(key, entry, scope, plan?.overrides);
	if (!prepared.ok) {
		const outcome = failedOutcome(key, prepared.reason);
		return { outcome, row: keyRow(member, { outcome }, plan, run) };
	}

	const result = await reinstallEntry(prepared.options, installed);
	const outcome = await keyOutcome(member, result, run, plan?.version);
	reportOutcomes([outcome], run.ui);
	const cloneFailure = remoteCloneFailure(entry, result);
	if (cloneFailure !== null) {
		const head = keyHead(member, run.home, plan?.version);
		return { outcome, row: cloneFailedRow(head, cloneFailure, [key]) };
	}
	const files =
		result.status === "success" ? result.copiedFiles.length : undefined;
	return { outcome, row: keyRow(member, { outcome, files }, plan, run) };
}

async function keyOutcome(
	member: GroupMember,
	result: CloneReinstallResult,
	run: UpdateRun,
	version: string | undefined,
): Promise<PluginOutcome> {
	if (result.status === "gone") {
		return settleGoneOutcome(member, run);
	}
	const newRef = result.status === "success" ? result.manifestEntry.ref : null;
	return mapReinstallResultToOutcome(
		member.key,
		member.entry,
		result,
		newRef,
		run.scope.name,
		version,
	);
}

/**
 * Why a remote entry's clone failed, or null when it didn't. A local
 * source's clone failure is its path failing the guard, told as its own.
 */
function remoteCloneFailure(
	entry: ManifestEntry,
	result: CloneReinstallResult,
): string | null {
	return entry.commit !== null &&
		result.status === "failed" &&
		result.failureReason === "clone-failed"
		? result.message
		: null;
}

/**
 * One key's row: a local entry's own, else its repo's with the entry under
 * it. A reinstalled entry's move is the one it made; any other's, the one it
 * set out to make.
 */
function keyRow(
	member: GroupMember,
	result: MemberResult,
	plan: KeyPlan | undefined,
	run: UpdateRun,
): Row {
	const head = keyHead(member, run.home, plan?.version);
	if (plan === undefined) {
		return localRow(head, result);
	}
	const { entry } = member;
	const { outcome } = result;
	const landed = isSuccessOutcome(outcome) ? outcome.newEntry : null;
	const move = versionMove({
		oldRef: entry.ref,
		newRef: landed?.ref ?? plan.target.newRef,
		oldCommit: entry.commit,
		newCommit: landed?.commit ?? plan.target.newCommit,
	});
	return reinstalledRow(head, { move }, [result]);
}

/** What a reinstall says while it runs: where it's going. */
export function updatingTo(newRef: string | null, newCommit: string): string {
	return `updating to ${moveTarget(newRef, newCommit)}…`;
}

/**
 * Removes or keeps a member found gone upstream. Gone is never a failure, but
 * a removal that can't delete the member's files is.
 */
export async function settleGoneOutcome(
	{ key, entry }: GroupMember,
	{ scope, yes, ui, home }: UpdateRun,
): Promise<PluginOutcome> {
	try {
		const head = entryHead(key, entry.commit === null, home);
		const settled = await settleGone(key, entry, scope, { yes, ui, head });
		if (settled.removed) {
			return { status: "gone-removed", key, ...told(settled.message) };
		}
		return {
			status: "gone-kept",
			key,
			...told(settled.message),
			...(settled.flags !== undefined ? { flags: settled.flags } : {}),
		};
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
	}
}
