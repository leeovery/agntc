import type { EntryGroup } from "./update-groups.js";

/**
 * The `owner/repo` a group installs from, taken from its first member key.
 * Every member of a group shares one repo, and a member key is `owner/repo`
 * for a standalone or `owner/repo/<member>` for a collection member — the
 * first two segments are the repo either way, so the member suffix is stripped.
 */
function repoOf(group: EntryGroup): string {
	return group.members[0]!.key.split("/").slice(0, 2).join("/");
}

/**
 * The single human label a group's repo shows across all three Phase 2 display
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
 * The INTERIM version-move renderer: short (7-char) commit hashes joined by the
 * ` -> ` arrow, matching today's {@link renderUpdateOutcomeSummary}
 * (`summary.ts`). Deliberately hash-only — Phase 3 rewords this one helper (and
 * its callers) to speak in tags where both refs are genuine semver tags, so the
 * tag-vs-hash rule must NOT be encoded here. Reused verbatim by the divergent-old
 * per-member move line (task 2-3).
 */
export function formatVersionMove(
	oldCommit: string,
	newCommit: string,
): string {
	return `${oldCommit.slice(0, 7)} -> ${newCommit.slice(0, 7)}`;
}

/**
 * The spinner-start header for a group's streamed update block: `Updating
 * <label>  <old> -> <new>  (N members)` when every updating member shares one
 * installed commit, or `Updating <label> -> <new>  (N members)` (resolved target
 * only) when their installed commits diverge — the shared "old" is then not
 * representable and moves to each member line (task 2-3).
 *
 * `oldCommits` are the UPDATING members' installed commits (one per attempted
 * member; up-to-date siblings excluded by the caller), so `(N members)` counts
 * the attempted set and is fixed at call time. Keying shared-vs-divergent on the
 * installed COMMIT (not ref) covers both an atomically-added constrained
 * collection (shared old) and members at different tags or branch/HEAD commits
 * (divergent old) uniformly. `members` is generic — a collection can hold plugin
 * members, not only skills.
 */
export function formatGroupHeader(input: {
	label: string;
	oldCommits: string[];
	newCommit: string;
}): string {
	const { label, oldCommits, newCommit } = input;
	const count = oldCommits.length;
	const distinct = new Set(oldCommits).size;
	if (distinct === 1) {
		return `Updating ${label}  ${formatVersionMove(oldCommits[0]!, newCommit)}  (${count} members)`;
	}
	return `Updating ${label} -> ${newCommit.slice(0, 7)}  (${count} members)`;
}
