import { gitErrorCause } from "./errors.js";
import { repoFromKey } from "./source-parser.js";
import { upgradeAdvice } from "./summary.js";
import type { EntryGroup } from "./update-groups.js";
import { formatVersionMove, isVersionTag } from "./version-resolve.js";

// The tag-vs-hash version-move rule is authored ONCE in version-resolve.ts (the
// neutral, cycle-free home of isVersionTag). Re-exported here so
// callers/tests keep importing `formatVersionMove` from update-render.js while
// the decision logic lives in exactly one place.
export { formatVersionMove };

/**
 * The `owner/repo` a group installs from, taken from its first member key.
 * Every member of a group shares one repo, and a member key is `owner/repo`
 * for a standalone or `owner/repo/<member>` for an entry from a multi-item repo — the
 * first two segments are the repo either way, so the member suffix is stripped.
 */
export function repoOf(group: EntryGroup): string {
	return repoFromKey(group.members[0]!.key);
}

/**
 * The single human label a group's repo shows across all three display
 * surfaces — the streamed group header, the collapsed trailing summary, and the
 * out-of-constraint footer — so all three render verbatim the same string.
 *
 * Almost always a repo has one group in a run, so the label is the bare
 * `owner/repo`. When one repo yields MULTIPLE groups (members added at different
 * intents), a bare label would merge two distinct groups' version info into one
 * indistinguishable line — a correctness bug — so each group disambiguates by
 * appending its intent: `@^1.2.3` (constrained caret), `@v2.0.0` / `@main`
 * (unconstrained exact-pin / branch), or the `@HEAD` sentinel for a HEAD-tracked
 * (`versionIntent === null`) group. Because `versionIntent = constraint ?? ref`,
 * the one suffix rule covers every case with no branch on `group.constrained`.
 */
export function groupLabel(group: EntryGroup, groups: EntryGroup[]): string {
	const base = repoOf(group);
	if (groups.filter((g) => repoOf(g) === base).length === 1) {
		return base;
	}
	const suffix = group.versionIntent === null ? "HEAD" : group.versionIntent;
	return `${base}@${suffix}`;
}

/**
 * The collapsed trailing line for a group's up-to-date members — one count, not
 * one line per member. `count` is the number of members categorized
 * (constrained-)up-to-date in this group, i.e. the members that did NOT stream
 * under the group header (the genuine-state split). `label` is the {@link
 * groupLabel}, so a multi-group repo disambiguates by its `@intent` suffix.
 */
export function formatUpToDateLine(label: string, count: number): string {
	return `${label}: ${count} up to date`;
}

/**
 * The collapsed trailing line for an exact-pinned group with newer tags — the
 * pinned-ref notice plus the re-add commands that pin the group to the newest
 * tag. One line per group: every member of an exact-pin group shares the
 * notice.
 *
 * `label` is the human prefix — the {@link groupLabel}, so a multi-group repo is
 * `@intent`-disambiguated. `pinnedRef` is the group's version intent;
 * `newestTag` is the newest of the group target's newer-tags list.
 */
export function formatNewerTagsLine(
	label: string,
	pinnedRef: string,
	newestTag: string,
	commands: string[],
): string {
	return `${label}: Pinned to ${pinnedRef} — newer tags available (latest: ${newestTag}). ${upgradeAdvice(commands)}`;
}

/**
 * The one line a failed update check prints: the collapsed trailing line for a
 * check-failed group (its one probe's reason, never one line per member), and
 * the single-key failure. `label` names the group or the key. The reason is cut
 * to its cause ({@link gitErrorCause}); a machine document keeps it whole.
 */
export function formatCheckFailedLine(label: string, reason: string): string {
	return `${label}: couldn't check for updates (${gitErrorCause(reason)}) — left untouched`;
}

/**
 * The collapsed trailing line for a constrained-no-match group — one line
 * carrying the group's single shared constraint. The constraint is a
 * group-level intent, so this count-collapses rather than enumerating members.
 */
export function formatConstrainedNoMatchLine(
	label: string,
	constraint: string,
): string {
	return `${label}: no tags satisfy ${constraint} — left untouched`;
}

/**
 * The one grouped line a group-fatal clone failure renders. Unlike the
 * other trailing collapses — which count-collapse a group-level result — this one
 * ENUMERATES the affected member basenames alongside the count, because the clone
 * is the group's single fatal action and naming the members it took down is the
 * useful signal. `label` is the {@link groupLabel} (repo, or `@intent`-suffixed for
 * a multi-group repo); `memberNames` are the attempted (updating) members'
 * basenames. The N `failed` outcomes still stand for exit accounting — this only
 * groups the DISPLAY.
 */
export function formatCloneFailureLine(
	label: string,
	memberNames: string[],
): string {
	return `${label}: clone failed — affects ${memberNames.length} members: ${memberNames.join(", ")}`;
}

/**
 * The spinner-start header for a group's streamed update block: `Updating
 * <label>  <old> -> <new>  (N members)` when every updating member shares one
 * installed commit, or `Updating <label> -> <new>  (N members)` (resolved target
 * only) when their installed commits diverge — the shared "old" is then not
 * representable and moves to each member line.
 *
 * The move tokens speak in semver TAGS where the shared {@link formatVersionMove}
 * rule fires (both refs genuine tags AND the ref moved) and short hashes
 * otherwise. `oldRefs` are the UPDATING members' installed refs (parallel to
 * `oldCommits`); `newRef` is the group's resolved effective ref (the target tag
 * for a constrained group, the branch name / null for a branch/HEAD group).
 *
 * `oldCommits` are the UPDATING members' installed commits (one per attempted
 * member; up-to-date siblings excluded by the caller), so `(N members)` counts
 * the attempted set and is fixed at call time. The shared-vs-divergent decision
 * is NOT derived here — the caller ({@link streamGroupWork}) computes it ONCE
 * from those same installed commits and threads it in as `divergent`, the single
 * source of truth shared with the per-member renderer so the header-move /
 * member-move XOR cannot drift. Keying shared-vs-divergent on the installed
 * COMMIT (not ref) covers both an atomically-added constrained group (shared
 * old) and members at different tags or branch/HEAD commits (divergent old)
 * uniformly. For the divergent target-only header, the resolved target renders as
 * its tag when it is one, else the short new hash. `members` is generic — a
 * group can hold packs, not only skills.
 */
export function formatGroupHeader(input: {
	label: string;
	oldCommits: string[];
	oldRefs: (string | null)[];
	newCommit: string;
	newRef: string | null;
	divergent: boolean;
}): string {
	const { label, oldCommits, oldRefs, newCommit, newRef, divergent } = input;
	const count = oldCommits.length;
	if (!divergent) {
		const move = formatVersionMove({
			oldRef: oldRefs[0]!,
			newRef,
			oldCommit: oldCommits[0]!,
			newCommit,
		});
		return `Updating ${label}  ${move}  (${count} members)`;
	}
	const target = isVersionTag(newRef) ? newRef : newCommit.slice(0, 7);
	return `Updating ${label} -> ${target}  (${count} members)`;
}

/** The clack log level a member line renders at, chosen by outcome severity. */
export type MemberLineLevel = "success" | "error";

/** A rendered member line: its clack log `level` and glyph-free `text`. */
export interface MemberLine {
	level: MemberLineLevel;
	text: string;
}

/**
 * A member that updated, as the streamed group block renders it. It carries —
 * only in the divergent-old case, where the header could not carry a shared
 * old — its own `move`.
 */
export interface MemberLineInput {
	kind: "success";
	name: string;
	move?: {
		oldRef: string | null;
		newRef: string | null;
		oldCommit: string;
		newCommit: string;
	} | null;
}

/**
 * Maps an updated member to its exact streamed line and clack log level — the
 * glyph (✓) is supplied by the level (`p.log.success`), NOT embedded in
 * `text`, matching today's summary convention: the bare `<name>`, with the
 * {@link formatVersionMove} as a trailing parenthetical in the divergent-old
 * case only.
 */
export function formatMemberLine(input: MemberLineInput): MemberLine {
	const suffix = input.move ? `  (${formatVersionMove(input.move)})` : "";
	return { level: "success", text: `${input.name}${suffix}` };
}
