import { execGit, fetchRemoteTagRefs } from "./git-utils.js";
import type { ManifestEntry } from "./manifest.js";
import { deriveCloneUrlFromKey } from "./source-parser.js";
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

export async function checkForUpdate(
	key: string,
	entry: ManifestEntry,
): Promise<UpdateCheckResult> {
	if (entry.ref === null && entry.commit === null) {
		return { status: "local" };
	}

	const url = deriveCloneUrlFromKey(key, entry.cloneUrl);

	if (entry.constraint !== undefined) {
		return checkConstrained(url, entry.ref, entry.constraint);
	}

	if (entry.ref === null) {
		return checkHead(url, entry.commit!);
	}

	return classifyAndCheck(url, entry.ref, entry.commit!);
}

// Determines a stored ref's type from remote truth rather than string shape:
// a single `ls-remote refs/heads/{ref} refs/tags/{ref}` probe reveals whether
// the ref exists as a branch and/or a tag. Routing on tagSha first implements
// the both-present tiebreak (tag wins, mirroring gitrevisions precedence).
async function classifyAndCheck(
	url: string,
	ref: string,
	installedCommit: string,
): Promise<UpdateCheckResult> {
	let stdout: string;
	try {
		({ stdout } = await execGit(
			["ls-remote", url, `refs/heads/${ref}`, `refs/tags/${ref}`],
			{ timeout: 15_000 },
		));
	} catch (err: unknown) {
		return { status: "check-failed", reason: (err as Error).message };
	}

	const { headSha, tagSha } = parseRefProbe(stdout, ref);

	if (tagSha !== null) {
		return checkTag(url, ref);
	}

	if (headSha !== null) {
		return compareResolvedSha(headSha, installedCommit);
	}

	return {
		status: "check-failed",
		reason: `Ref '${ref}' not found on remote as a branch or tag`,
	};
}

async function checkHead(
	url: string,
	installedCommit: string,
): Promise<UpdateCheckResult> {
	try {
		const { stdout } = await execGit(["ls-remote", url, "HEAD"], {
			timeout: 15_000,
		});
		const remoteSha = parseLsRemoteSha(stdout);
		if (remoteSha === null) {
			return { status: "check-failed", reason: "No HEAD ref found on remote" };
		}
		return compareResolvedSha(remoteSha, installedCommit);
	} catch (err: unknown) {
		return {
			status: "check-failed",
			reason: (err as Error).message,
		};
	}
}

// The classifier confirms `refs/tags/{ref}` exists before routing here, so the
// tag is always present in the fetched list — the "tag not found" branch is
// unreachable and omitted. The probe's single tag sha cannot yield the
// newer-tags set, so this issues its own `--tags` for the full tag list.
async function checkTag(url: string, tag: string): Promise<UpdateCheckResult> {
	try {
		const allTagRefs = await fetchRemoteTagRefs(url);
		const allTags = allTagRefs.map((r) => r.tag);
		const newerTags = findNewerTags(allTags, tag);
		if (newerTags !== null && newerTags.length > 0) {
			return { status: "newer-tags", tags: newerTags };
		}
		return { status: "up-to-date" };
	} catch (err: unknown) {
		return {
			status: "check-failed",
			reason: (err as Error).message,
		};
	}
}

function detectLatestOverall(tags: string[], bestTag: string): string | null {
	const latest = resolveLatestVersion(tags);
	if (latest === null) return null;
	if (latest.tag === bestTag) return null;
	return latest.tag;
}

async function checkConstrained(
	url: string,
	currentRef: string | null,
	constraint: string,
): Promise<UpdateCheckResult> {
	try {
		const parsed = await fetchRemoteTagRefs(url);
		const tagCommitMap = new Map(parsed.map((r) => [r.tag, r.sha]));
		const tags = parsed.map((r) => r.tag);

		const best = resolveVersion(constraint, tags);
		if (best === null) {
			return { status: "constrained-no-match" };
		}

		const latestOverall = detectLatestOverall(tags, best.tag);

		if (best.tag === currentRef) {
			return { status: "constrained-up-to-date", latestOverall };
		}

		const commit = tagCommitMap.get(best.tag);
		if (commit === undefined) {
			return {
				status: "check-failed",
				reason: `Resolved tag '${best.tag}' not found in remote tags`,
			};
		}

		return {
			status: "constrained-update-available",
			tag: best.tag,
			commit,
			latestOverall,
		};
	} catch (err: unknown) {
		return {
			status: "check-failed",
			reason: (err as Error).message,
		};
	}
}
