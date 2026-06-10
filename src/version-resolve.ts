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
