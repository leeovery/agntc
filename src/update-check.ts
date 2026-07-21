import { execGit, fetchRemoteTagRefs } from "./git-utils.js";
import type { ManifestEntry } from "./manifest.js";
import { deriveCloneUrlFromKey } from "./source-parser.js";
import type { EntryGroup } from "./update-groups.js";
import { resolveLatestVersion, resolveVersion } from "./version-resolve.js";

export type UpdateCheckResult =
	| { status: "local" }
	| { status: "up-to-date" }
	| { status: "update-available"; remoteCommit: string }
	| { status: "newer-tags"; tags: string[] }
	| {
			status: "constrained-update-available";
			tag: string;
			commit: string;
			latestOverall: string | null;
	  }
	| { status: "constrained-up-to-date"; latestOverall: string | null }
	| { status: "constrained-no-match" }
	| { status: "check-failed"; reason: string };

type ConstrainedWithLatest = Extract<
	UpdateCheckResult,
	{ status: "constrained-update-available" | "constrained-up-to-date" }
> & { latestOverall: string };

export function hasOutOfConstraintVersion(
	result: UpdateCheckResult,
): result is ConstrainedWithLatest {
	return (
		(result.status === "constrained-update-available" ||
			result.status === "constrained-up-to-date") &&
		result.latestOverall !== null
	);
}

function parseLsRemoteSha(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (trimmed === "") return null;
	const firstLine = trimmed.split("\n")[0]!;
	const sha = firstLine.split("\t")[0]!.trim();
	return sha || null;
}

// Parses a mixed `ls-remote refs/heads/{ref} refs/tags/{ref}` response,
// returning the head and/or tag sha keyed by EXACT ref path. Unlike
// parseLsRemoteSha (first line only, discards the ref path) and parseTagRefs
// (tags-only, strips refs/tags/), this classifies a combined heads+tags probe.
// Matching is order-independent and requires full-path equality, so the peeled
// refs/tags/{ref}^{} line and any prefix-sharing ref are ignored.
export function parseRefProbe(
	stdout: string,
	ref: string,
): { headSha: string | null; tagSha: string | null } {
	const trimmed = stdout.trim();
	if (trimmed === "") return { headSha: null, tagSha: null };

	const headPath = `refs/heads/${ref}`;
	const tagPath = `refs/tags/${ref}`;
	let headSha: string | null = null;
	let tagSha: string | null = null;

	for (const line of trimmed.split("\n")) {
		if (line.trim() === "") continue;
		const parts = line.split("\t");
		const sha = parts[0]?.trim() ?? "";
		const refPath = parts[1]?.trim() ?? "";
		if (refPath === headPath) {
			headSha = sha || null;
		} else if (refPath === tagPath) {
			tagSha = sha || null;
		}
	}

	return { headSha, tagSha };
}

function findNewerTags(allTags: string[], currentTag: string): string[] | null {
	const currentIndex = allTags.indexOf(currentTag);
	if (currentIndex === -1) return null;
	return allTags.slice(currentIndex + 1);
}

// The single "is a resolved remote sha ahead of the installed commit?" rule,
// shared by the branch arm of classifyAndCheck and checkHead. Both resolve a
// remote sha and compare it against the installed commit identically.
function compareResolvedSha(
	remoteSha: string,
	installedCommit: string,
): UpdateCheckResult {
	if (remoteSha === installedCommit) {
		return { status: "up-to-date" };
	}
	return { status: "update-available", remoteCommit: remoteSha };
}

/**
 * A group's single shared resolution target, produced by ONE network probe per
 * group and then compared against each member's OWN installed commit by
 * {@link categorizeMember}. Splitting resolution (this) from categorization
 * closes the commit- and category-level races: the group resolves one target,
 * every member is classified against it — never against a single member during
 * resolution. The `tag` arm is the exact-pin (unconstrained tag ref) case.
 */
export type GroupTarget =
	| {
			kind: "constrained";
			tag: string;
			commit: string;
			latestOverall: string | null;
	  }
	| { kind: "constrained-no-match" }
	| { kind: "tag"; tag: string; newerTags: string[] }
	| { kind: "branch"; resolvedSha: string }
	| { kind: "head"; resolvedSha: string }
	| { kind: "check-failed"; reason: string };

export async function checkForUpdate(
	key: string,
	entry: ManifestEntry,
): Promise<UpdateCheckResult> {
	if (entry.ref === null && entry.commit === null) {
		return { status: "local" };
	}

	const url = deriveCloneUrlFromKey(key, entry.cloneUrl);
	const target = await resolveTarget(url, entry);
	return categorizeMember(entry, target);
}

/**
 * Resolves a group's shared target with a single network round-trip, using a
 * representative member — all members share intent (`constraint ?? ref`) and
 * clone URL, so any member resolves the same target. Performs NO per-member
 * comparison; classifying each member against the returned target is
 * {@link categorizeMember}'s job.
 */
export async function resolveGroupTarget(
	group: EntryGroup,
): Promise<GroupTarget> {
	const { entry } = group.members[0]!;
	return resolveTarget(group.cloneUrl, entry);
}

// Shared resolution path for both the singleton `checkForUpdate` and the group
// orchestrator: routes on the entry's pre-resolution intent (constraint, then
// HEAD-tracked `ref === null`, then a concrete tag/branch ref) exactly as the
// old `checkForUpdate` did — but returns the raw resolved target instead of a
// per-member verdict, so it never compares against a single member's commit.
async function resolveTarget(
	url: string,
	entry: ManifestEntry,
): Promise<GroupTarget> {
	if (entry.constraint !== undefined) {
		return resolveConstrainedTarget(url, entry.constraint);
	}

	if (entry.ref === null) {
		return resolveHeadTarget(url);
	}

	return resolveRefTarget(url, entry.ref);
}

/**
 * Maps a resolved {@link GroupTarget} plus a member's OWN ref/commit to an
 * {@link UpdateCheckResult}. Pure — no network. Only the member's installed
 * commit/ref drives its category, so from ONE shared target a member already at
 * the target reports up-to-date while a behind sibling updates (the intended
 * genuine-state split), and exact-pin vs caret stay separate (each keyed on its
 * own arm, never on a resolved commit).
 */
export function categorizeMember(
	entry: ManifestEntry,
	target: GroupTarget,
): UpdateCheckResult {
	switch (target.kind) {
		case "constrained":
			if (target.tag === entry.ref) {
				return {
					status: "constrained-up-to-date",
					latestOverall: target.latestOverall,
				};
			}
			return {
				status: "constrained-update-available",
				tag: target.tag,
				commit: target.commit,
				latestOverall: target.latestOverall,
			};
		case "constrained-no-match":
			return { status: "constrained-no-match" };
		case "tag":
			if (target.newerTags.length > 0) {
				return { status: "newer-tags", tags: target.newerTags };
			}
			return { status: "up-to-date" };
		case "branch":
		case "head":
			return compareResolvedSha(target.resolvedSha, entry.commit!);
		case "check-failed":
			return { status: "check-failed", reason: target.reason };
	}
}

// Determines a stored ref's type from remote truth rather than string shape:
// a single `ls-remote refs/heads/{ref} refs/tags/{ref}` probe reveals whether
// the ref exists as a branch and/or a tag. Routing on tagSha first implements
// the both-present tiebreak (tag wins, mirroring gitrevisions precedence).
// Returns the RAW target (branch head sha or the tag's newer-tags list) without
// comparing against any single member's commit.
async function resolveRefTarget(
	url: string,
	ref: string,
): Promise<GroupTarget> {
	let stdout: string;
	try {
		({ stdout } = await execGit(
			["ls-remote", url, `refs/heads/${ref}`, `refs/tags/${ref}`],
			{ timeout: 15_000 },
		));
	} catch (err: unknown) {
		return { kind: "check-failed", reason: (err as Error).message };
	}

	const { headSha, tagSha } = parseRefProbe(stdout, ref);

	if (tagSha !== null) {
		return resolveTagTarget(url, ref);
	}

	if (headSha !== null) {
		return { kind: "branch", resolvedSha: headSha };
	}

	return {
		kind: "check-failed",
		reason: `Ref '${ref}' not found on remote as a branch or tag`,
	};
}

async function resolveHeadTarget(url: string): Promise<GroupTarget> {
	try {
		const { stdout } = await execGit(["ls-remote", url, "HEAD"], {
			timeout: 15_000,
		});
		const remoteSha = parseLsRemoteSha(stdout);
		if (remoteSha === null) {
			return { kind: "check-failed", reason: "No HEAD ref found on remote" };
		}
		return { kind: "head", resolvedSha: remoteSha };
	} catch (err: unknown) {
		return { kind: "check-failed", reason: (err as Error).message };
	}
}

// resolveRefTarget confirms `refs/tags/{ref}` exists before routing here, so the
// tag is always present in the fetched list — the "tag not found" branch is
// unreachable and omitted. The probe's single tag sha cannot yield the
// newer-tags set, so this issues its own `--tags` for the full tag list and
// returns it raw. `findNewerTags === null` (current tag absent from the list)
// collapses to an empty list, which categorizeMember treats as up-to-date —
// preserving the old checkTag behaviour.
async function resolveTagTarget(
	url: string,
	tag: string,
): Promise<GroupTarget> {
	try {
		const allTagRefs = await fetchRemoteTagRefs(url);
		const allTags = allTagRefs.map((r) => r.tag);
		const newerTags = findNewerTags(allTags, tag);
		return { kind: "tag", tag, newerTags: newerTags ?? [] };
	} catch (err: unknown) {
		return { kind: "check-failed", reason: (err as Error).message };
	}
}

function detectLatestOverall(tags: string[], bestTag: string): string | null {
	const latest = resolveLatestVersion(tags);
	if (latest === null) return null;
	if (latest.tag === bestTag) return null;
	return latest.tag;
}

// The old checkConstrained body minus the `best.tag === currentRef` comparison:
// resolves the best-within-constraint tag+commit and the out-of-constraint
// latestOverall ONCE, leaving the up-to-date-vs-update decision to
// categorizeMember (each member against its own ref). `best.tag` always comes
// from the fetched tags, so tagCommitMap always has it; the undefined branch is
// defensive.
async function resolveConstrainedTarget(
	url: string,
	constraint: string,
): Promise<GroupTarget> {
	try {
		const parsed = await fetchRemoteTagRefs(url);
		const tagCommitMap = new Map(parsed.map((r) => [r.tag, r.sha]));
		const tags = parsed.map((r) => r.tag);

		const best = resolveVersion(constraint, tags);
		if (best === null) {
			return { kind: "constrained-no-match" };
		}

		const commit = tagCommitMap.get(best.tag);
		if (commit === undefined) {
			return {
				kind: "check-failed",
				reason: `Resolved tag '${best.tag}' not found in remote tags`,
			};
		}

		return {
			kind: "constrained",
			tag: best.tag,
			commit,
			latestOverall: detectLatestOverall(tags, best.tag),
		};
	} catch (err: unknown) {
		return { kind: "check-failed", reason: (err as Error).message };
	}
}
