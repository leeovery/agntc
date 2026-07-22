import { formatDroppedAgentsSuffix } from "./summary.js";
import type { EntryGroup } from "./update-groups.js";
import { formatVersionMove, isVersionTag } from "./version-resolve.js";

// The tag-vs-hash version-move rule is authored ONCE in version-resolve.ts (the
// neutral, cycle-free home of isVersionTag). Re-exported here so the Phase 2
// callers/tests keep importing `formatVersionMove` from update-render.js while
// the decision logic lives in exactly one place.
export { formatVersionMove };

/**
 * The `owner/repo` a group installs from, taken from its first member key.
 * Every member of a group shares one repo, and a member key is `owner/repo`
 * for a standalone or `owner/repo/<member>` for a collection member — the
 * first two segments are the repo either way, so the member suffix is stripped.
 */
export function repoOf(group: EntryGroup): string {
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
 * The collapsed trailing line for a group's up-to-date members — one count, not
 * one line per member (task 2-5). `count` is the number of members categorized
 * (constrained-)up-to-date in this group, i.e. the members that did NOT stream
 * under the group header (the genuine-state split). `label` is the {@link
 * groupLabel}, so a multi-group repo disambiguates by its `@intent` suffix.
 */
export function formatUpToDateLine(label: string, count: number): string {
	return `${label}: ${count} up to date`;
}

/**
 * The collapsed trailing line for an exact-pinned group with newer tags — the
 * pinned-ref notice plus the REPO-LEVEL re-add command (task 2-5 / spec
 * acceptance 9). One line per group: every member of an exact-pin group shares
 * the notice, so it never enumerates. The command is `add <commandTarget>@<newest>`
 * (repo-level — re-adds the collection/plugin at the pinned newest tag),
 * mirroring the single-key path's member-scoped `add <key>@<newest>` at group
 * granularity.
 *
 * `label` is the human prefix — the {@link groupLabel}, so a multi-group repo is
 * `@intent`-disambiguated. `commandTarget` is the SEPARATE BARE `owner/repo`
 * ({@link repoOf}) the command re-adds from, distinct from the display label so
 * the emitted `npx agntc add ${commandTarget}@${newestTag}` carries exactly one
 * `@` even when the prefix is disambiguated — mirroring the out-of-constraint
 * footer's bare `repo` field ({@link renderOutOfConstraintSection}). `pinnedRef`
 * is the group's version intent; `newestTag` is the newest of the group target's
 * newer-tags list.
 */
export function formatNewerTagsLine(
	label: string,
	commandTarget: string,
	pinnedRef: string,
	newestTag: string,
): string {
	return `${label}: Pinned to ${pinnedRef} — newer tags available (latest: ${newestTag}). To upgrade: npx agntc add ${commandTarget}@${newestTag}`;
}

/**
 * The collapsed trailing line for a check-failed group — one line carrying the
 * group's single shared probe reason (task 2-5). A group's resolution probe is
 * one network round-trip, so a failure is group-level: it count-collapses rather
 * than enumerating the members.
 */
export function formatCheckFailedLine(label: string, reason: string): string {
	return `${label}: check failed — ${reason}`;
}

/**
 * The collapsed trailing line for a constrained-no-match group — one line
 * carrying the group's single shared constraint (task 2-5). The constraint is a
 * group-level intent, so this count-collapses rather than enumerating members.
 */
export function formatConstrainedNoMatchLine(
	label: string,
	constraint: string,
): string {
	return `${label}: no tags satisfy ${constraint} — left untouched`;
}

/**
 * The one grouped line a group-fatal clone failure renders (task 2-6). Unlike the
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
 * representable and moves to each member line (task 2-3).
 *
 * The move tokens speak in semver TAGS where the shared {@link formatVersionMove}
 * rule fires (both refs genuine tags AND the ref moved) and short hashes
 * otherwise. `oldRefs` are the UPDATING members' installed refs (parallel to
 * `oldCommits`); `newRef` is the group's resolved effective ref (the target tag
 * for a constrained group, the branch name / null for a branch/HEAD group).
 *
 * `oldCommits` are the UPDATING members' installed commits (one per attempted
 * member; up-to-date siblings excluded by the caller), so `(N members)` counts
 * the attempted set and is fixed at call time. Keying shared-vs-divergent on the
 * installed COMMIT (not ref) covers both an atomically-added constrained
 * collection (shared old) and members at different tags or branch/HEAD commits
 * (divergent old) uniformly. For the divergent target-only header, the resolved
 * target renders as its tag when it is one, else the short new hash. `members` is
 * generic — a collection can hold plugin members, not only skills.
 */
export function formatGroupHeader(input: {
	label: string;
	oldCommits: string[];
	oldRefs: (string | null)[];
	newCommit: string;
	newRef: string | null;
}): string {
	const { label, oldCommits, oldRefs, newCommit, newRef } = input;
	const count = oldCommits.length;
	const distinct = new Set(oldCommits).size;
	if (distinct === 1) {
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
export type MemberLineLevel = "success" | "error" | "warn";

/** A rendered member line: its clack log `level` and glyph-free `text`. */
export interface MemberLine {
	level: MemberLineLevel;
	text: string;
}

/**
 * Every per-member outcome the streamed group block renders, discriminated on
 * `kind`. A `success` carries the effective `agents`, any `droppedAgents`, and —
 * only in the divergent-old case (task 2-2), where the header could not carry a
 * shared old — its own `move`. The three loud non-success variants carry their
 * already-assembled `message` / `recoveryHint` (built upstream by
 * {@link buildAbortMessage} / {@link buildCopySafetyMessage} / the copy-failed
 * recovery hint), so the wording lives at one source and merely rides the line
 * here. `no-agents` carries only its `name` — a skip with a fixed sentence.
 */
export type MemberLineInput =
	| {
			kind: "success";
			name: string;
			agents: string[];
			droppedAgents: string[];
			move?: {
				oldRef: string | null;
				newRef: string | null;
				oldCommit: string;
				newCommit: string;
			} | null;
	  }
	| { kind: "copy-failed"; name: string; recoveryHint: string }
	| { kind: "aborted"; name: string; message: string }
	| { kind: "blocked"; name: string; message: string }
	| { kind: "no-agents"; name: string };

/**
 * Maps a member outcome to its exact streamed line and clack log level — the
 * glyph (✓/✗/⚠) is supplied by the level (`p.log.success/error/warn`), NOT
 * embedded in `text`, matching today's summary convention (update.ts:588-609).
 * Task 2-4 dispatches via `p.log[level](text)`.
 *
 * A success renders `<name> → <agents>` (the `→` separator matching
 * {@link renderCollectionAddSummary}), with an optional trailing parenthetical
 * built from an ordered parts list: the {@link formatVersionMove} (divergent-old
 * case only) then the dropped-agents body ({@link formatDroppedAgentsSuffix}
 * `parenthetical` style — single source of the "support removed by plugin
 * author" phrasing), joined by `; ` inside one shared `(...)`. The loud
 * non-success variants ride their inline message; `no-agents` is a warn skip.
 */
export function formatMemberLine(input: MemberLineInput): MemberLine {
	switch (input.kind) {
		case "success": {
			const parts: string[] = [];
			if (input.move) {
				parts.push(formatVersionMove(input.move));
			}
			if (input.droppedAgents.length > 0) {
				parts.push(
					formatDroppedAgentsSuffix(input.droppedAgents, "parenthetical"),
				);
			}
			const suffix = parts.length > 0 ? `  (${parts.join("; ")})` : "";
			return {
				level: "success",
				text: `${input.name} → ${input.agents.join(", ")}${suffix}`,
			};
		}
		case "copy-failed":
			return {
				level: "error",
				text: `${input.name}: copy failed — ${input.recoveryHint}`,
			};
		// aborted and blocked share one line shape (`<name>: <message>`); the
		// difference — recorded-type remove+add remedy vs none — lives in the
		// pre-built message, not here.
		case "aborted":
		case "blocked":
			return { level: "error", text: `${input.name}: ${input.message}` };
		case "no-agents":
			return {
				level: "warn",
				text: `${input.name}: skipped — no longer supports installed agents`,
			};
	}
}
