import { execGit } from "./git-utils.js";
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

// Heuristic: matches "v1...", "1...", etc. Does not match branch names like
// "dev", "main", or "feature-x". Will misclassify tags that start with a
// non-numeric, non-v prefix (e.g. "release-1.0").
function isTagRef(ref: string): boolean {
	return /^v?\d/.test(ref);
}

function parseLsRemoteSha(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (trimmed === "") return null;
	const firstLine = trimmed.split("\n")[0]!;
	const sha = firstLine.split("\t")[0]!.trim();
	return sha || null;
}

function parseAllTags(stdout: string): string[] {
	const trimmed = stdout.trim();
	if (trimmed === "") return [];
	return trimmed
		.split("\n")
		.filter((line) => line.trim() !== "")
		.filter((line) => !line.includes("^{}"))
		.map((line) => {
			const ref = line.split("\t")[1]!.trim();
			return ref.replace("refs/tags/", "");
		});
}

function findNewerTags(allTags: string[], currentTag: string): string[] | null {
	const currentIndex = allTags.indexOf(currentTag);
	if (currentIndex === -1) return null;
	return allTags.slice(currentIndex + 1);
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

	if (isTagRef(entry.ref)) {
		return checkTag(url, entry.ref, entry.commit!);
	}

	return checkBranch(url, entry.ref, entry.commit!);
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
		if (remoteSha === installedCommit) {
			return { status: "up-to-date" };
		}
		return { status: "update-available", remoteCommit: remoteSha };
	} catch (err: unknown) {
		return {
			status: "check-failed",
			reason: (err as Error).message,
		};
	}
}

async function checkBranch(
	url: string,
	branch: string,
	installedCommit: string,
): Promise<UpdateCheckResult> {
	try {
		const { stdout } = await execGit(
			["ls-remote", url, `refs/heads/${branch}`],
			{ timeout: 15_000 },
		);
		const remoteSha = parseLsRemoteSha(stdout);
		if (remoteSha === null) {
			return {
				status: "check-failed",
				reason: `Branch '${branch}' not found on remote`,
			};
		}
		if (remoteSha === installedCommit) {
			return { status: "up-to-date" };
		}
		return { status: "update-available", remoteCommit: remoteSha };
	} catch (err: unknown) {
		return {
			status: "check-failed",
			reason: (err as Error).message,
		};
	}
}

async function checkTag(
	url: string,
	tag: string,
	_installedCommit: string,
): Promise<UpdateCheckResult> {
	try {
		const { stdout } = await execGit(["ls-remote", "--tags", url], {
			timeout: 15_000,
		});
		const allTags = parseAllTags(stdout);
		const newerTags = findNewerTags(allTags, tag);
		if (newerTags === null) {
			return {
				status: "check-failed",
				reason: `Tag '${tag}' not found on remote`,
			};
		}
		if (newerTags.length > 0) {
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

function parseTagCommitMap(stdout: string): Map<string, string> {
	const trimmed = stdout.trim();
	if (trimmed === "") return new Map();
	const result = new Map<string, string>();
	for (const line of trimmed.split("\n")) {
		if (line.trim() === "" || line.includes("^{}")) continue;
		const parts = line.split("\t");
		const sha = parts[0]?.trim();
		const ref = parts[1]?.trim().replace("refs/tags/", "");
		if (sha && ref) {
			result.set(ref, sha);
		}
	}
	return result;
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
		const { stdout } = await execGit(["ls-remote", "--tags", url], {
			timeout: 15_000,
		});
		const tagCommitMap = parseTagCommitMap(stdout);
		const tags = [...tagCommitMap.keys()];

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
