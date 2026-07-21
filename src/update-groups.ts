import type { Manifest, ManifestEntry } from "./manifest.js";
import { deriveCloneUrlFromKey } from "./source-parser.js";

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
