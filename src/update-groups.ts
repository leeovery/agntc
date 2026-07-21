import {
	buildAbortMessage,
	buildCopySafetyMessage,
	type CloneReinstallResult,
	cloneRepoOnce,
	isCloneReinstallFailure,
	mapCloneFailure,
	runPipeline,
} from "./clone-reinstall.js";
import { assertSubpathWithinClone, PathTraversalError } from "./copy-safety.js";
import { errorMessage } from "./errors.js";
import { cleanupTempDir } from "./git-clone.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import {
	deriveCloneUrlFromKey,
	resolveUpdateSourceDir,
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
 * legacy per-entry path (`processUpdateForAll`) and the grouped orchestrator
 * ({@link processGroupUpdate}) so both emit the identical shape.
 */
export type PluginOutcome =
	| { status: "updated"; key: string; summary: string; newEntry: ManifestEntry }
	| {
			status: "refreshed";
			key: string;
			summary: string;
			newEntry: ManifestEntry;
	  }
	| { status: "up-to-date"; key: string; summary: string }
	| { status: "newer-tags"; key: string; summary: string }
	| { status: "check-failed"; key: string; summary: string }
	| { status: "failed"; key: string; summary: string }
	| { status: "copy-failed"; key: string; summary: string }
	| { status: "aborted"; key: string; summary: string }
	| { status: "blocked"; key: string; summary: string }
	| { status: "skipped-no-agents"; key: string; summary: string }
	| { status: "constrained-no-match"; key: string; summary: string };

/**
 * Maps a {@link CloneReinstallResult} (from the shared reinstall half) plus the
 * member's key/entry to a {@link PluginOutcome}, using `status` as the single
 * cross-boundary discriminator. Factored out of `processUpdateForAll` so the
 * grouped orchestrator and the legacy per-entry path emit byte-identical
 * outcomes — the failure arms (skipped-no-agents / copy-failed / aborted /
 * blocked / clone-failed→failed / unknown→failed) and the success split
 * (local `refreshed` vs git `updated`) live in exactly one place.
 */
export function mapReinstallResultToOutcome(
	key: string,
	entry: ManifestEntry,
	result: CloneReinstallResult,
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
			onCloneFailed: (msg) => ({
				status: "failed",
				key,
				summary: `${key}: Failed — ${msg}`,
			}),
			onUnknown: (msg) => ({
				status: "failed",
				key,
				summary: `${key}: Failed — ${msg}`,
			}),
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
		};
	}

	return {
		status: "updated",
		key,
		summary: renderUpdateOutcomeSummary({
			type: "git-update",
			key,
			oldCommit: entry.commit,
			newCommit: result.manifestEntry.commit!,
			droppedAgents: result.droppedAgents,
		}),
		newEntry: result.manifestEntry,
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

interface EffectiveTarget {
	/** The clone `--branch` override: the resolved tag for a constrained group,
	 * `undefined` for a branch/HEAD group (clone at the stored branch/HEAD ref). */
	ref: string | undefined;
	/** The commit recorded for every updating member — the group's single
	 * resolved sha, so all members land on one commit (group-first resolve-once). */
	commit: string | null;
}

/**
 * Derives the group's shared effective clone ref + recorded commit from the
 * resolved {@link GroupTarget}. Only `constrained` / `branch` / `head` targets
 * ever carry updating members, so those are the meaningful arms; the remaining
 * kinds (`tag` newer-tags, `constrained-no-match`, `check-failed`) never reach
 * {@link processGroupUpdate} with an updating subset and fall through to a
 * no-op default.
 */
function resolveEffectiveTarget(target: GroupTarget): EffectiveTarget {
	switch (target.kind) {
		case "constrained":
			return { ref: target.tag, commit: target.commit };
		case "branch":
		case "head":
			return { ref: undefined, commit: target.resolvedSha };
		default:
			return { ref: undefined, commit: null };
	}
}

/**
 * Reinstalls a single group member from the shared clone, fully isolated in its
 * own try/catch so one member's throw can never abort its siblings. Preserves
 * the per-member lexical `sourceSubpath` containment guard
 * ({@link assertSubpathWithinClone}) — dropping it would be a path-traversal
 * regression — mapping a {@link PathTraversalError} to the same clone-failed
 * pre-flight outcome the singleton path emits (no nuke, no copy, install
 * intact). `cloneRoot` stays the whole clone so within-clone cross-member
 * symlinks are allowed and only escapes beyond it are rejected.
 */
async function reinstallMember(
	member: { key: string; entry: ManifestEntry },
	tempDir: string,
	effectiveRef: string | undefined,
	effectiveCommit: string | null,
	projectDir: string,
): Promise<PluginOutcome> {
	const { key, entry } = member;
	try {
		if (entry.sourceSubpath) {
			try {
				assertSubpathWithinClone(tempDir, entry.sourceSubpath);
			} catch (err) {
				if (err instanceof PathTraversalError) {
					return mapReinstallResultToOutcome(key, entry, {
						status: "failed",
						failureReason: "clone-failed",
						message: err.message,
					});
				}
				throw err;
			}
		}

		const sourceDir = resolveUpdateSourceDir(tempDir, key, entry.sourceSubpath);

		const result = await runPipeline({
			key,
			entry,
			projectDir,
			sourceDir,
			cloneRoot: tempDir,
			newRef: effectiveRef ?? null,
			newCommit: effectiveCommit,
		});

		return mapReinstallResultToOutcome(key, entry, result);
	} catch (err) {
		return {
			status: "failed",
			key,
			summary: `${key}: Failed — ${errorMessage(err)}`,
		};
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
	const { ref: effectiveRef, commit: effectiveCommit } =
		resolveEffectiveTarget(target);

	let tempDir: string;
	try {
		({ tempDir } = await cloneRepoOnce({
			key: firstMember.key,
			entry: firstMember.entry,
			...(effectiveRef !== undefined ? { newRef: effectiveRef } : {}),
		}));
	} catch (err) {
		const reason = errorMessage(err);
		return {
			cloneFailed: true,
			reason,
			outcomes: members.map((member) => ({
				status: "failed",
				key: member.key,
				summary: `${member.key}: Failed — ${reason}`,
			})),
		};
	}

	const outcomes: PluginOutcome[] = [];
	try {
		for (const member of members) {
			outcomes.push(
				await reinstallMember(
					member,
					tempDir,
					effectiveRef,
					effectiveCommit,
					projectDir,
				),
			);
		}
	} finally {
		await cleanupTempDir(tempDir).catch(() => {});
	}

	return { cloneFailed: false, outcomes };
}
