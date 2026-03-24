import { clean } from "semver";

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
