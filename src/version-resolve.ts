import { clean, gte, maxSatisfying } from "semver";

export function normalizeTags(tags: string[]): Map<string, string> {
	const result = new Map<string, string>();

	for (const tag of tags) {
		const cleaned = clean(tag);
		if (cleaned === null) {
			continue;
		}

		const existing = result.get(cleaned);
		if (existing === undefined) {
			result.set(cleaned, tag);
		} else if (
			tag.trimStart().startsWith("v") &&
			!existing.trimStart().startsWith("v")
		) {
			result.set(cleaned, tag);
		}
	}

	return result;
}

// A ref is "tag-based" when it cleanly parses as a semver version (e.g. "v2.0.0",
// "1.4.2"). Branch names and HEAD-tracking refs don't, so this distinguishes a
// version-pinned install (which can switch to any other tag) from one tracking a
// moving ref (which can't).
export function isVersionTag(ref: string | null): boolean {
	return ref !== null && clean(ref) !== null;
}

/** The old/new refs and commits a version move is rendered from. */
export interface VersionMoveInput {
	oldRef: string | null;
	newRef: string | null;
	oldCommit: string | null;
	newCommit: string;
}

/**
 * The SINGLE tag-vs-hash decision for a version move, shared by the grouped
 * progress surface ({@link import("./update-render.js")}) and the summary
 * renderers. Renders `<oldRef> -> <newRef>` when BOTH refs are genuine semver
 * tags AND the ref actually moved (`oldRef !== newRef`); otherwise falls back to
 * short (7-char) commit hashes, with `unknown` for a null old commit. The signal
 * is never the string shape alone — {@link isVersionTag} is `clean()`-based, so
 * a `v4` branch (clean() null) and a `v4.0.0` branch whose only the commit moved
 * (`oldRef === newRef`) both land on the hash path. The ` -> ` ASCII arrow is
 * verbatim.
 */
export function formatVersionMove(input: VersionMoveInput): string {
	if (
		isVersionTag(input.oldRef) &&
		isVersionTag(input.newRef) &&
		input.oldRef !== input.newRef
	) {
		return `${input.oldRef} -> ${input.newRef}`;
	}
	const oldShort = input.oldCommit ? input.oldCommit.slice(0, 7) : "unknown";
	return `${oldShort} -> ${input.newCommit.slice(0, 7)}`;
}

export interface VersionOverrides {
	newRef: string;
	newCommit: string;
}

export interface ResolvedVersion {
	tag: string;
	version: string;
}

export function resolveVersion(
	constraint: string,
	tags: string[],
): ResolvedVersion | null {
	const normalized = normalizeTags(tags);
	const cleanedVersions = [...normalized.keys()];

	const matched = maxSatisfying(cleanedVersions, constraint);
	if (matched === null) {
		return null;
	}

	const tag = normalized.get(matched);
	if (tag === undefined) {
		return null;
	}

	return { tag, version: matched };
}

export function resolveLatestVersion(tags: string[]): ResolvedVersion | null {
	return resolveVersion("*", tags);
}

export function isAtOrAboveVersion(
	currentRef: string | null,
	candidateTag: string,
): boolean {
	if (currentRef === null) return false;
	const cleanedCurrent = clean(currentRef);
	const cleanedCandidate = clean(candidateTag);
	if (cleanedCurrent === null || cleanedCandidate === null) return false;
	return gte(cleanedCurrent, cleanedCandidate);
}
