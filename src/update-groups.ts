import {
	buildAbortMessage,
	buildCopySafetyMessage,
	type CloneReinstallResult,
	cloneRepoOnce,
	isCloneReinstallFailure,
	mapCloneFailure,
	recordCopyFailure,
	recordReinstall,
	runPipeline,
} from "./clone-reinstall.js";
import { errorMessage } from "./errors.js";
import { cleanupTempDir } from "./git-clone.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { removeEntry } from "./manifest.js";
import { type SourceWalk, sourceWalk } from "./nuke-reinstall-pipeline.js";
import type { Scope, ScopeName } from "./scope.js";
import {
	deriveCloneUrlFromKey,
	resolveGuardedSourceDir,
} from "./source-parser.js";
import { renderUpdateOutcomeSummary } from "./summary.js";
import type { GroupTarget } from "./update-check.js";

/**
 * A set of non-local manifest entries whose pre-resolution version intent points
 * at the identical tree, so the update engine can clone and resolve them once.
 *
 * Keyed by `(cloneUrl, versionIntent)` where `versionIntent = constraint ?? ref`
 * — a constrained entry keys on its (stable) `constraint` and EXCLUDES the
 * mutating `ref`, so a singly-updated member stays grouped with its behind
 * siblings; an unconstrained entry keys on its `ref` (branch name, pinned tag,
 * or `null` for HEAD-tracked). All fields are computed from the manifest alone
 * with no network call.
 */
export interface EntryGroup {
	cloneUrl: string;
	versionIntent: string | null;
	constrained: boolean;
	members: GroupMember[];
}

export type GroupMember = { key: string; entry: ManifestEntry };

/**
 * Namespaces the group-key intent component so a caret string can never
 * key-collide with a tag ref: `c:` prefixes a constraint, `r:` prefixes a ref.
 * The `' HEAD'` sentinel keys a HEAD-tracked (`ref === null`) unconstrained
 * entry distinctly from any real ref.
 */
function intentKey(entry: ManifestEntry): string {
	return entry.constraint !== undefined
		? `c:${entry.constraint}`
		: `r:${entry.ref ?? " HEAD"}`;
}

/**
 * Partitions every NON-LOCAL manifest entry into ordered groups keyed by
 * `(resolvedCloneUrl, versionIntent)`, preserving manifest (processing) order:
 * a group takes the position of its first-seen member. Local entries
 * (`commit === null`) are excluded entirely — they never clone. No network call.
 */
export function groupEntriesForUpdate(manifest: Manifest): EntryGroup[] {
	const groups = new Map<string, EntryGroup>();

	for (const [key, entry] of Object.entries(manifest)) {
		if (entry.commit === null) {
			continue;
		}

		const cloneUrl = deriveCloneUrlFromKey(key, entry.cloneUrl);
		const fullKey = `${cloneUrl} ${intentKey(entry)}`;

		let group = groups.get(fullKey);
		if (group === undefined) {
			group = {
				cloneUrl,
				versionIntent: entry.constraint ?? entry.ref,
				constrained: entry.constraint !== undefined,
				members: [],
			};
			groups.set(fullKey, group);
		}
		group.members.push({ key, entry });
	}

	return [...groups.values()];
}

/**
 * Per-entry outcome of an all-mode update, collected across the run for the
 * trailing summary and the `hasFailedOutcome` exit-code decision. Shared by the
 * local path (`processLocalUpdate`) and the grouped orchestrator
 * ({@link processGroupUpdate}) so both emit the identical shape.
 *
 * The two success variants (`updated`/`refreshed`) carry the reinstalled
 * `newEntry` (persisted per unit) alongside the pre-rendered `summary` the
 * collapsed group-of-one / local display path consumes verbatim, and the keys
 * of the loose skills a pack `absorbed`, whose entries persistence drops.
 *
 * An entry found gone upstream starts as `gone-kept`, which is true until its
 * removal is settled; `-y` or a yes turns it into `gone-removed`. An entry a
 * pack took over during the run ends as `absorbed`.
 *
 * `key` is where the entry is recorded once the outcome is applied. A
 * reinstall `add` would key differently moves the entry, and `previousKey`
 * names the key it had ({@link keyBefore}).
 */
export type PluginOutcome =
	| ({
			status: "updated";
			key: string;
			summary: string;
			newEntry: ManifestEntry;
	  } & Reinstalled)
	| ({
			status: "refreshed";
			key: string;
			summary: string;
			newEntry: ManifestEntry;
	  } & Reinstalled)
	| { status: "up-to-date"; key: string }
	| { status: "newer-tags"; key: string }
	| { status: "check-failed"; key: string }
	| { status: "failed"; key: string; summary: string }
	| { status: "copy-failed"; key: string; summary: string; absorbed: string[] }
	| { status: "aborted"; key: string; summary: string }
	| { status: "blocked"; key: string; summary: string }
	| { status: "constrained-no-match"; key: string }
	| { status: "gone-kept"; key: string; summary: string; flags?: string[] }
	| { status: "gone-removed"; key: string; summary: string }
	| {
			status: "absorbed";
			key: string;
			into: string;
			summary: string;
			previousKey?: string;
	  };

interface Reinstalled {
	notes: string[];
	absorbed: string[];
	previousKey?: string;
}

/** The key an outcome's entry had when the run started. */
export function keyBefore(outcome: PluginOutcome): string {
	return (
		("previousKey" in outcome ? outcome.previousKey : undefined) ?? outcome.key
	);
}

/**
 * The SINGLE constructor of the `failed` {@link PluginOutcome} literal and its
 * `<key>: Failed — <message>` summary wording. Every failure origin — the
 * `prepareReinstall`-not-ok branch, the `processLocalUpdate` outer catch, the
 * `onCloneFailed`/`onRemoveFailed` arms of {@link mapReinstallResultToOutcome}, the
 * {@link reinstallMember} catch, and the clone-fatal fan-out in
 * {@link processGroupUpdate} — routes through here, so the discriminant, the
 * `key`, and the exact prefix/body wording can never drift apart (a new failure
 * origin is a one-line call).
 */
export function failedOutcome(key: string, message: string): PluginOutcome {
	return { status: "failed", key, summary: `${key}: Failed — ${message}` };
}

/**
 * The SINGLE definition of the two-status "this member updated" success set
 * (`updated` for a git move, `refreshed` for a local re-copy). Narrows to the
 * variants that carry {@link ManifestEntry} `newEntry`, so the persistence and
 * member-line sites read `outcome.newEntry` without a cast. A future success
 * variant is a one-line change here.
 */
export function isSuccessOutcome(
	outcome: PluginOutcome,
): outcome is Extract<PluginOutcome, { status: "updated" | "refreshed" }> {
	return outcome.status === "updated" || outcome.status === "refreshed";
}

/**
 * The loose skill entries a pack took over. Their files are removed before
 * the pack is copied, so they are taken over whether or not the copy worked.
 */
function absorbedBy(outcome: PluginOutcome): string[] {
	return isSuccessOutcome(outcome) || outcome.status === "copy-failed"
		? outcome.absorbed
		: [];
}

/**
 * The outcome of a loose skill entry the pack whose outcome is `pack` took
 * over. `from` is the key the entry had when the run started.
 */
export function absorbedOutcome(
	key: string,
	pack: PluginOutcome,
	from: string = key,
): PluginOutcome {
	const into = pack.key;
	return {
		status: "absorbed",
		key,
		into,
		summary: isSuccessOutcome(pack)
			? `${key} is now part of the pack ${into}`
			: `${key} was removed — the pack ${into} took it over, then failed to install`,
		...(from !== key ? { previousKey: from } : {}),
	};
}

/**
 * Folds one outcome into the manifest: a reinstall records its new entry,
 * under the key it moved to when it moved, a copy failure or a removal drops
 * the entry, and both a reinstall and a copy failure drop the loose skills a
 * pack took over. Anything else leaves the manifest as it was, same object
 * included.
 */
export function applyOutcome(
	manifest: Manifest,
	outcome: PluginOutcome,
): Manifest {
	if (isSuccessOutcome(outcome)) {
		return recordReinstall(
			outcome.absorbed.reduce(removeEntry, manifest),
			keyBefore(outcome),
			outcome.key,
			outcome.newEntry,
		);
	}
	if (outcome.status === "copy-failed") {
		return recordCopyFailure(manifest, outcome.key, outcome.absorbed);
	}
	if (outcome.status === "gone-removed") {
		return removeEntry(manifest, outcome.key);
	}
	return manifest;
}

/**
 * Gives every entry a pack took over during the run an `absorbed` outcome, in
 * place of whatever it got before, keeping the key it moved from.
 */
export function withAbsorptions(outcomes: PluginOutcome[]): PluginOutcome[] {
	const takenBy = new Map<string, PluginOutcome>();
	for (const outcome of outcomes) {
		for (const looseKey of absorbedBy(outcome)) {
			takenBy.set(looseKey, outcome);
		}
	}
	const startedAs = new Map(
		outcomes.map((outcome) => [outcome.key, keyBefore(outcome)]),
	);
	return [
		...outcomes.filter((outcome) => !takenBy.has(outcome.key)),
		...[...takenBy].map(([key, pack]) =>
			absorbedOutcome(key, pack, startedAs.get(key)),
		),
	];
}

/**
 * Maps a {@link CloneReinstallResult} (from the shared reinstall half) plus the
 * member's key/entry to a {@link PluginOutcome}, using `status` as the single
 * cross-boundary discriminator. Factored out of `processLocalUpdate` so the
 * grouped orchestrator and the local path emit byte-identical
 * outcomes — the failure arms (copy-failed / aborted / blocked /
 * clone-failed→failed / remove-failed→failed) and the success split
 * (local `refreshed` vs git `updated`) live in exactly one place.
 *
 * `newRef` is the group's resolved target ref threaded through for the git-update
 * summary's tag-vs-hash rule (the resolved tag for a constrained group; the
 * unchanged branch name / `null` for a branch/HEAD group) — paired with the
 * member's pre-update `entry.ref` as the move's old ref. It is consulted only on
 * the git-update arm; the local (`refreshed`) and failure arms ignore it.
 *
 * A success is keyed where the reinstall recorded it, with the member's key as
 * `previousKey` when that moved. A `gone` result maps to an unsettled
 * `gone-kept`: nothing was touched yet.
 */
export function mapReinstallResultToOutcome(
	key: string,
	entry: ManifestEntry,
	result: CloneReinstallResult,
	newRef: string | null,
	scope: ScopeName,
): PluginOutcome {
	if (result.status === "gone") {
		return {
			status: "gone-kept",
			key,
			summary: `Kept ${key} — it's gone upstream`,
		};
	}
	if (isCloneReinstallFailure(result)) {
		return mapCloneFailure<PluginOutcome>(result, {
			onCopyFailed: (msg, absorbed) => ({
				status: "copy-failed",
				key,
				summary: msg,
				absorbed,
			}),
			onAborted: (abort) => ({
				status: "aborted",
				key,
				summary: buildAbortMessage(key, entry, abort, scope),
			}),
			onBlocked: (reason) => ({
				status: "blocked",
				key,
				summary: buildCopySafetyMessage(key, reason),
			}),
			onCloneFailed: (msg) => failedOutcome(key, msg),
			onRemoveFailed: (msg) => failedOutcome(key, msg),
		});
	}

	const reinstalled = {
		notes: result.notes,
		absorbed: result.absorbed,
		...(result.key !== key ? { previousKey: key } : {}),
	};

	if (entry.commit === null) {
		return {
			status: "refreshed",
			key: result.key,
			summary: renderUpdateOutcomeSummary({
				type: "local-update",
				key: result.key,
			}),
			newEntry: result.manifestEntry,
			...reinstalled,
		};
	}

	return {
		status: "updated",
		key: result.key,
		summary: renderUpdateOutcomeSummary({
			type: "git-update",
			key: result.key,
			oldRef: entry.ref,
			newRef,
			oldCommit: entry.commit,
			newCommit: result.manifestEntry.commit!,
		}),
		newEntry: result.manifestEntry,
		...reinstalled,
	};
}

/**
 * The additive discriminated result {@link processGroupUpdate} returns. The
 * `outcomes` array is the SAME per-member model on both arms — one
 * {@link PluginOutcome} per attempted member — and is the only thing exit
 * accounting and manifest persistence read. `cloneFailed` is a pure DISPLAY
 * signal layered over the N-outcome fan-out: when true, the
 * streaming layer renders one enumerated grouped line naming the
 * affected members instead of N per-member lines, and `reason` carries the
 * group's single shared clone-failure message. It does NOT change the outcomes
 * array (still N `failed` outcomes) or the exit.
 */
export type GroupUpdateResult =
	| { cloneFailed: true; reason: string; outcomes: PluginOutcome[] }
	| { cloneFailed: false; outcomes: PluginOutcome[] };

/**
 * The three facets a streamed group's resolved {@link GroupTarget} projects,
 * derived by the SINGLE switch over `GroupTarget.kind` ({@link groupTargetFacets}).
 * Every downstream "what ref/commit does this group land on" question reads one of
 * these instead of re-switching, so the clone, the header "new", the member-line
 * "new", and the collapsed group-of-one "new" cannot drift apart.
 */
export interface GroupTargetFacets {
	/** The commit recorded for every updating member — the group's single resolved
	 * sha (so all members land on one commit) AND the display "new" commit for the
	 * header and per-member moves. */
	commit: string;
	/** The clone `--branch` override and the ref members move to: the resolved tag
	 * for a constrained group, `undefined` for a branch/HEAD group (clone at, and
	 * keep, the stored branch/HEAD ref).
	 * Deliberately DISTINCT from {@link displayRef} — a branch/HEAD group clones the
	 * stored ref (`undefined` override) yet displays its version intent. */
	cloneRef: string | undefined;
	/** The display "new" ref fed to the tag-vs-hash move rule: the resolved tag for
	 * a constrained group (renders as a tag); the group's shared version intent (the
	 * branch name, or `null` for HEAD-tracked) for a branch/HEAD group — never a
	 * tag, so those always fall to hashes. Equals each member's own `ref` for a
	 * branch/HEAD group by the grouping invariant, so routing the member-line move
	 * through it reproduces the old `cloneRef ?? entry.ref`. */
	displayRef: string | null;
}

/**
 * The SINGLE derivation of a streamed group's `{ commit, cloneRef, displayRef }`
 * from its resolved {@link GroupTarget} — the one switch over `GroupTarget.kind`
 * that owns the group's clone ref/commit and its display ref/commit. Only
 * `constrained` / `branch` / `head` targets ever carry updating members, so those
 * are the meaningful arms; the remaining kinds (`tag` newer-tags,
 * `constrained-no-match`, `check-failed`) never reach a streamed group and fall
 * through to a benign no-op default. A new streamed `GroupTarget` arm is a
 * single-site change here.
 */
export function groupTargetFacets(
	target: GroupTarget,
	group: EntryGroup,
): GroupTargetFacets {
	switch (target.kind) {
		case "constrained":
			return {
				commit: target.commit,
				cloneRef: target.tag,
				displayRef: target.tag,
			};
		case "branch":
		case "head":
			return {
				commit: target.resolvedSha,
				cloneRef: undefined,
				displayRef: group.versionIntent,
			};
		default:
			return { commit: "", cloneRef: undefined, displayRef: null };
	}
}

/** A group's one clone, with the walk its members share for moved skills. */
interface SharedClone {
	root: string;
	walk: SourceWalk;
}

/**
 * Reinstalls a single group member from the shared clone, fully isolated in its
 * own try/catch so one member's throw can never abort its siblings. Obtains its
 * guarded source dir via the shared {@link resolveGuardedSourceDir} — the single
 * home of the per-member lexical `sourceSubpath` containment guard, composed
 * identically by the singleton path (`cloneAndReinstall`). Dropping it would be
 * a path-traversal regression; a rejected subpath maps to the same clone-failed
 * pre-flight outcome the singleton path emits (no nuke, no copy, install intact).
 * `cloneRoot` stays the whole clone so within-clone cross-member symlinks are
 * allowed and only escapes beyond it are rejected.
 */
async function reinstallMember(
	member: GroupMember,
	clone: SharedClone,
	facets: GroupTargetFacets,
	scope: Scope,
	installed: Manifest,
): Promise<PluginOutcome> {
	const { key, entry } = member;
	const { commit, cloneRef, displayRef } = facets;
	// The group's resolved display ref for the tag-vs-hash move — read from the
	// single {@link groupTargetFacets} projection: the resolved tag for a
	// constrained group, else the group's shared version intent (the branch name,
	// or `null` for HEAD), which equals this member's own `ref` by the grouping
	// invariant. The clone ref (`cloneRef`) stays SEPARATE below — a branch/HEAD
	// group clones the stored ref (`undefined` override) yet displays its intent.
	// Sharing this value with the grouped header keeps the collapsed
	// group-of-one wording identical to the grouped multi-member wording.
	try {
		const guarded = resolveGuardedSourceDir(
			clone.root,
			key,
			entry.sourceSubpath,
		);
		if (!guarded.ok) {
			return mapReinstallResultToOutcome(
				key,
				entry,
				{
					status: "failed",
					failureReason: "clone-failed",
					message: guarded.message,
				},
				displayRef,
				scope.name,
			);
		}

		const result = await runPipeline({
			key,
			entry,
			installed,
			scope,
			sourceDir: guarded.sourceDir,
			cloneRoot: clone.root,
			walk: clone.walk,
			newRef: cloneRef,
			newCommit: commit,
		});

		return mapReinstallResultToOutcome(
			key,
			entry,
			result,
			displayRef,
			scope.name,
		);
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
	}
}

/**
 * The group orchestrator (all-mode only): clones the group's tree exactly once
 * via {@link cloneRepoOnce}, then reinstalls each updating `member` sequentially
 * from that shared clone through the clone-agnostic reinstall half
 * ({@link runPipeline}), returning one {@link PluginOutcome} per member.
 * Members whose skill moved share one walk of the clone to find it.
 *
 * `members` is the group's updating subset (categorized `update-available` /
 * `constrained-update-available`); the clone is taken from the group's first
 * member since every member shares URL + effective ref. The whole member loop is
 * wrapped so {@link cleanupTempDir} runs exactly once in a `finally`, and each
 * member is isolated in its own try/catch (see {@link reinstallMember}).
 *
 * A clone failure is group-fatal: `cloneRepoOnce` has already retried 3×
 * internally, so a throw is final and the orchestrator adds no retry. It is
 * caught here and fanned out to one `failed` {@link PluginOutcome} per UPDATING
 * member (the `members` param — up-to-date siblings never entered this loop),
 * each attributed to its own key. No manifest read/write happens on this path —
 * clone-failed removes no entries (only copy-failed does), so all N installs stay
 * intact — and there is no tempDir to clean up. The N `failed` outcomes still
 * trip `hasFailedOutcome` → non-zero exit, matching today's per-entry accounting.
 *
 * The return is an additive {@link GroupUpdateResult} wrapper: `cloneFailed` is a
 * DISPLAY-only discriminator letting the streaming layer render one
 * enumerated grouped line for a clone-fatal group instead of N per-member lines;
 * the `outcomes` array is unchanged on both arms — still N `failed` outcomes on
 * clone failure — so exit accounting and manifest persistence are untouched.
 *
 * `installed` is the manifest as the group starts; each member reinstalls
 * against it as the earlier members left it, so a member a pack absorbed is
 * skipped as `absorbed`.
 */
export async function processGroupUpdate(
	group: EntryGroup,
	members: GroupMember[],
	target: GroupTarget,
	scope: Scope,
	installed: Manifest,
): Promise<GroupUpdateResult> {
	const firstMember = group.members[0]!;
	const facets = groupTargetFacets(target, group);
	const { cloneRef } = facets;

	let tempDir: string;
	try {
		({ tempDir } = await cloneRepoOnce({
			key: firstMember.key,
			entry: firstMember.entry,
			...(cloneRef !== undefined ? { newRef: cloneRef } : {}),
		}));
	} catch (err) {
		const reason = errorMessage(err);
		return {
			cloneFailed: true,
			reason,
			outcomes: members.map((member) => failedOutcome(member.key, reason)),
		};
	}

	try {
		const clone = { root: tempDir, walk: sourceWalk(tempDir) };
		const reinstall = (member: GroupMember, current: Manifest) =>
			reinstallMember(member, clone, facets, scope, current);
		return {
			cloneFailed: false,
			outcomes: await reinstallInTurn(members, installed, reinstall),
		};
	} finally {
		await cleanupTempDir(tempDir).catch(() => {});
	}
}

/**
 * Reinstalls members one after another, each against the manifest the ones
 * before it left. A member an earlier pack absorbed is skipped.
 */
export async function reinstallInTurn(
	members: GroupMember[],
	installed: Manifest,
	reinstall: (member: GroupMember, current: Manifest) => Promise<PluginOutcome>,
): Promise<PluginOutcome[]> {
	const outcomes: PluginOutcome[] = [];
	const takenBy = new Map<string, PluginOutcome>();
	let current = installed;
	for (const member of members) {
		const pack = takenBy.get(member.key);
		const outcome =
			pack === undefined
				? await reinstall(member, current)
				: absorbedOutcome(member.key, pack);
		for (const looseKey of absorbedBy(outcome)) {
			takenBy.set(looseKey, outcome);
		}
		outcomes.push(outcome);
		current = applyOutcome(current, outcome);
	}
	return outcomes;
}

/**
 * Packs ahead of loose skills, otherwise in the given order, so a loose skill
 * a pack absorbs is skipped rather than updated and then taken over.
 */
export function packsFirst<T extends { entry: ManifestEntry }>(
	members: T[],
): T[] {
	const isPack = (member: T) => member.entry.type === "pack";
	return [...members.filter(isPack), ...members.filter((m) => !isPack(m))];
}
