import {
	buildAbortMessage,
	buildCopySafetyMessage,
	type CloneReinstallResult,
	cloneRepoOnce,
	isCloneReinstallFailure,
	mapCloneFailure,
	runPipeline,
} from "./clone-reinstall.js";
import type { AgentId } from "./drivers/types.js";
import { errorMessage } from "./errors.js";
import { cleanupTempDir } from "./git-clone.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
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
	members: Array<{ key: string; entry: ManifestEntry }>;
}

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
 * Per-plugin outcome of an all-mode update, collected across the run for the
 * trailing summary and the `hasFailedOutcome` exit-code decision. Shared by the
 * local path (`processLocalUpdate`) and the grouped orchestrator
 * ({@link processGroupUpdate}) so both emit the identical shape.
 *
 * The two success variants (`updated`/`refreshed`) carry the STRUCTURED fields
 * the multi-member streamed renderer composes from — `newEntry` (effective
 * agents + persistence) and `droppedAgents` (the pipeline's own dropped set, in
 * source order) — alongside the pre-rendered `summary` the collapsed
 * group-of-one / local display path consumes verbatim. The renderer reads the
 * structured `droppedAgents` directly rather than recomputing an
 * `oldEntry`-vs-`newEntry` set-difference that had to be provably equal to this.
 */
export type PluginOutcome =
	| {
			status: "updated";
			key: string;
			summary: string;
			newEntry: ManifestEntry;
			droppedAgents: AgentId[];
	  }
	| {
			status: "refreshed";
			key: string;
			summary: string;
			newEntry: ManifestEntry;
			droppedAgents: AgentId[];
	  }
	| { status: "up-to-date"; key: string }
	| { status: "newer-tags"; key: string }
	| { status: "check-failed"; key: string }
	| { status: "failed"; key: string; summary: string }
	| { status: "copy-failed"; key: string; summary: string }
	| { status: "aborted"; key: string; summary: string }
	| { status: "blocked"; key: string; summary: string }
	| { status: "skipped-no-agents"; key: string; summary: string }
	| { status: "constrained-no-match"; key: string };

/**
 * The SINGLE constructor of the `failed` {@link PluginOutcome} literal and its
 * `<key>: Failed — <message>` summary wording. Every failure origin — the
 * `prepareReinstall`-not-ok branch, the `processLocalUpdate` outer catch, the
 * `onCloneFailed`/`onUnknown` arms of {@link mapReinstallResultToOutcome}, the
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
 * Maps a {@link CloneReinstallResult} (from the shared reinstall half) plus the
 * member's key/entry to a {@link PluginOutcome}, using `status` as the single
 * cross-boundary discriminator. Factored out of `processLocalUpdate` so the
 * grouped orchestrator and the local path emit byte-identical
 * outcomes — the failure arms (skipped-no-agents / copy-failed / aborted /
 * blocked / clone-failed→failed / unknown→failed) and the success split
 * (local `refreshed` vs git `updated`) live in exactly one place.
 *
 * `newRef` is the group's resolved target ref threaded through for the git-update
 * summary's tag-vs-hash rule (the resolved tag for a constrained group; the
 * unchanged branch name / `null` for a branch/HEAD group) — paired with the
 * member's pre-update `entry.ref` as the move's old ref. It is consulted only on
 * the git-update arm; the local (`refreshed`) and failure arms ignore it.
 */
export function mapReinstallResultToOutcome(
	key: string,
	entry: ManifestEntry,
	result: CloneReinstallResult,
	newRef: string | null,
): PluginOutcome {
	if (isCloneReinstallFailure(result)) {
		return mapCloneFailure<PluginOutcome>(result, {
			onNoAgents: () => ({
				status: "skipped-no-agents",
				key,
				summary: `${key}: Skipped — no longer supports installed agents`,
			}),
			onCopyFailed: (msg) => ({ status: "copy-failed", key, summary: msg }),
			onAborted: (recordedType, reason) => ({
				status: "aborted",
				key,
				summary: buildAbortMessage(key, recordedType, reason),
			}),
			onBlocked: (reason) => ({
				status: "blocked",
				key,
				summary: buildCopySafetyMessage(key, reason),
			}),
			onCloneFailed: (msg) => failedOutcome(key, msg),
			onUnknown: (msg) => failedOutcome(key, msg),
		});
	}

	if (entry.commit === null) {
		return {
			status: "refreshed",
			key,
			summary: renderUpdateOutcomeSummary({
				type: "local-update",
				key,
				droppedAgents: result.droppedAgents,
			}),
			newEntry: result.manifestEntry,
			droppedAgents: result.droppedAgents,
		};
	}

	return {
		status: "updated",
		key,
		summary: renderUpdateOutcomeSummary({
			type: "git-update",
			key,
			oldRef: entry.ref,
			newRef,
			oldCommit: entry.commit,
			newCommit: result.manifestEntry.commit!,
			droppedAgents: result.droppedAgents,
		}),
		newEntry: result.manifestEntry,
		droppedAgents: result.droppedAgents,
	};
}

/**
 * The additive discriminated result {@link processGroupUpdate} returns. The
 * `outcomes` array is the SAME per-member model on both arms — one
 * {@link PluginOutcome} per attempted member — and is the only thing exit
 * accounting and manifest persistence read. `cloneFailed` is a pure DISPLAY
 * signal layered over Phase 1's N-outcome fan-out (task 1-7): when true, the
 * streaming layer (task 2-6) renders one enumerated grouped line naming the
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
	/** The clone `--branch` override: the resolved tag for a constrained group,
	 * `undefined` for a branch/HEAD group (clone at the stored branch/HEAD ref).
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
	member: { key: string; entry: ManifestEntry },
	tempDir: string,
	facets: GroupTargetFacets,
	projectDir: string,
): Promise<PluginOutcome> {
	const { key, entry } = member;
	const { commit, cloneRef, displayRef } = facets;
	// The group's resolved display ref for the tag-vs-hash move — read from the
	// single {@link groupTargetFacets} projection: the resolved tag for a
	// constrained group, else the group's shared version intent (the branch name,
	// or `null` for HEAD), which equals this member's own `ref` by the grouping
	// invariant. The clone ref (`cloneRef`) stays SEPARATE below — a branch/HEAD
	// group clones the stored ref (`undefined` override) yet displays its intent.
	// Sharing this value with the grouped header (task 3-1) keeps the collapsed
	// group-of-one wording identical to the grouped multi-member wording.
	try {
		const guarded = resolveGuardedSourceDir(tempDir, key, entry.sourceSubpath);
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
			);
		}

		const result = await runPipeline({
			key,
			entry,
			projectDir,
			sourceDir: guarded.sourceDir,
			cloneRoot: tempDir,
			newRef: cloneRef ?? null,
			newCommit: commit,
		});

		return mapReinstallResultToOutcome(key, entry, result, displayRef);
	} catch (err) {
		return failedOutcome(key, errorMessage(err));
	}
}

/**
 * The group orchestrator (all-mode only): clones the group's tree exactly once
 * via {@link cloneRepoOnce}, then reinstalls each updating `member` sequentially
 * from that shared clone through the clone-agnostic reinstall half
 * ({@link runPipeline}), returning one {@link PluginOutcome} per member.
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
 * DISPLAY-only discriminator (task 2-6) letting the streaming layer render one
 * enumerated grouped line for a clone-fatal group instead of N per-member lines;
 * the `outcomes` array is unchanged on both arms — still N `failed` outcomes on
 * clone failure — so exit accounting and manifest persistence are untouched.
 */
export async function processGroupUpdate(
	group: EntryGroup,
	members: Array<{ key: string; entry: ManifestEntry }>,
	target: GroupTarget,
	projectDir: string,
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

	const outcomes: PluginOutcome[] = [];
	try {
		for (const member of members) {
			outcomes.push(await reinstallMember(member, tempDir, facets, projectDir));
		}
	} finally {
		await cleanupTempDir(tempDir).catch(() => {});
	}

	return { cloneFailed: false, outcomes };
}
