import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { RemovedAssets } from "../../src/remove-render.js";

export function makeEntry(
	overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
	return {
		ref: null,
		commit: "a".repeat(40),
		installedAt: "2026-02-01T00:00:00.000Z",
		files: [".claude/skills/my-skill/"],
		cloneUrl: null,
		...overrides,
	};
}

export function makeManifest(
	keysOrEntries: string[] | Record<string, ManifestEntry>,
): Manifest {
	if (Array.isArray(keysOrEntries)) {
		const manifest: Manifest = {};
		for (const key of keysOrEntries) {
			manifest[key] = makeEntry();
		}
		return manifest;
	}
	return { ...keysOrEntries };
}

/** An entry recording `files`, as a removal's rows take it, `skills` naming a pack's folders that are skills. */
export function makeRemoved(
	files: string[],
	{
		skills = [],
		...entry
	}: Partial<ManifestEntry> & { skills?: string[] } = {},
): RemovedAssets {
	return {
		entry: makeEntry({ ...entry, files }),
		assets: { counts: {}, other: 0, skills },
	};
}
