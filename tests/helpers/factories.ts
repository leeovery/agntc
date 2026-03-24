import { vi } from "vitest";
import type { AssetType } from "../../src/drivers/types.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";

export function makeEntry(
	overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
	return {
		ref: null,
		commit: "a".repeat(40),
		installedAt: "2026-02-01T00:00:00.000Z",
		agents: ["claude"],
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

export function makeFakeDriver() {
	return {
		detect: vi.fn().mockResolvedValue(true),
		getTargetDir: vi.fn((assetType: AssetType) => {
			if (assetType === "skills") return ".claude/skills";
			if (assetType === "agents") return ".claude/agents";
			if (assetType === "hooks") return ".claude/hooks";
			return null;
		}),
	};
}
