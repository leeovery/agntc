import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../src/exit-signal.js";
import {
	addEntry,
	buildManifestEntry,
	type Manifest,
	type ManifestEntry,
	manifestTypeFromDetected,
	readManifest,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../src/manifest.js";

vi.mock("@clack/prompts", () => ({
	log: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		message: vi.fn(),
	},
}));

import * as p from "@clack/prompts";

const mockLog = vi.mocked(p.log);

let testDir: string;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "agntc-manifest-test-"));
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe("readManifest", () => {
	it("returns empty object when dir missing", async () => {
		const result = await readManifest(join(testDir, "nonexistent"));
		expect(result).toEqual({});
	});

	it("returns empty object when file missing but dir exists", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		const result = await readManifest(testDir);
		expect(result).toEqual({});
	});

	it("parses single entry", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
				type: "skill",
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(manifest),
		);

		const result = await readManifest(testDir);
		expect(result).toEqual(manifest);
	});

	it("parses multiple entries", async () => {
		const manifest: Manifest = {
			"owner/repo/skill-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
				cloneUrl: null,
				type: "skill",
			},
			"owner/repo/skill-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/skill-b/", ".codex/skills/skill-b/"],
				cloneUrl: null,
				type: "skill",
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(manifest),
		);

		const result = await readManifest(testDir);
		expect(result).toEqual(manifest);
	});

	it("propagates permission errors", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		const manifestPath = join(testDir, ".agntc", "manifest.json");
		await writeFile(manifestPath, "{}");
		await chmod(manifestPath, 0o000);

		try {
			await expect(readManifest(testDir)).rejects.toThrow();
			await expect(readManifest(testDir)).rejects.toMatchObject({
				code: "EACCES",
			});
		} finally {
			await chmod(manifestPath, 0o644);
		}
	});

	it("throws on invalid JSON", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(join(testDir, ".agntc", "manifest.json"), "{bad json}");

		await expect(readManifest(testDir)).rejects.toThrow();
	});
});

describe("writeManifest", () => {
	it("creates dir and file when missing", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
			},
		};

		await writeManifest(testDir, manifest);

		const content = await readFile(
			join(testDir, ".agntc", "manifest.json"),
			"utf-8",
		);
		expect(JSON.parse(content)).toEqual(manifest);
	});

	it("overwrites existing file", async () => {
		const old: Manifest = {
			"owner/repo/old": {
				ref: "main",
				commit: "old123",
				installedAt: "2026-01-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/old/"],
				cloneUrl: null,
			},
		};
		const updated: Manifest = {
			"owner/repo/new": {
				ref: "v2",
				commit: "new456",
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["codex"],
				files: [".codex/skills/new/"],
				cloneUrl: null,
			},
		};

		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(old),
		);

		await writeManifest(testDir, updated);

		const content = await readFile(
			join(testDir, ".agntc", "manifest.json"),
			"utf-8",
		);
		expect(JSON.parse(content)).toEqual(updated);
	});

	it("formats with 2-space indent and trailing newline", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
			},
		};

		await writeManifest(testDir, manifest);

		const content = await readFile(
			join(testDir, ".agntc", "manifest.json"),
			"utf-8",
		);
		const expected = JSON.stringify(manifest, null, 2) + "\n";
		expect(content).toBe(expected);
	});

	it("uses atomic write (no partial writes)", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
			},
		};

		await writeManifest(testDir, manifest);

		// Verify the manifest.json exists and is valid
		const content = await readFile(
			join(testDir, ".agntc", "manifest.json"),
			"utf-8",
		);
		expect(JSON.parse(content)).toEqual(manifest);

		// Verify no temp files remain in .agntc/
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(join(testDir, ".agntc"));
		expect(files).toEqual(["manifest.json"]);
	});
});

describe("addEntry", () => {
	it("adds to empty manifest", () => {
		const entry: ManifestEntry = {
			ref: "main",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		const result = addEntry({}, "owner/repo/skill", entry);
		expect(result).toEqual({ "owner/repo/skill": entry });
	});

	it("preserves existing entries", () => {
		const existing: Manifest = {
			"owner/repo/skill-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
				cloneUrl: null,
			},
		};
		const newEntry: ManifestEntry = {
			ref: "v2",
			commit: "def456",
			installedAt: "2026-01-16T10:00:00.000Z",
			agents: ["codex"],
			files: [".codex/skills/skill-b/"],
			cloneUrl: null,
		};

		const result = addEntry(existing, "owner/repo/skill-b", newEntry);
		expect(result).toEqual({
			"owner/repo/skill-a": existing["owner/repo/skill-a"],
			"owner/repo/skill-b": newEntry,
		});
	});

	it("overwrites same key (reinstall)", () => {
		const original: ManifestEntry = {
			ref: "main",
			commit: "old123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};
		const updated: ManifestEntry = {
			ref: "v2",
			commit: "new456",
			installedAt: "2026-02-01T00:00:00.000Z",
			agents: ["claude", "codex"],
			files: [".claude/skills/skill/", ".codex/skills/skill/"],
			cloneUrl: null,
		};
		const manifest: Manifest = { "owner/repo/skill": original };

		const result = addEntry(manifest, "owner/repo/skill", updated);
		expect(result["owner/repo/skill"]).toEqual(updated);
	});

	it("does not mutate input", () => {
		const original: Manifest = {
			"owner/repo/skill-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
				cloneUrl: null,
			},
		};
		const originalCopy = JSON.parse(JSON.stringify(original)) as Manifest;
		const newEntry: ManifestEntry = {
			ref: "v2",
			commit: "def456",
			installedAt: "2026-01-16T10:00:00.000Z",
			agents: ["codex"],
			files: [".codex/skills/skill-b/"],
			cloneUrl: null,
		};

		const result = addEntry(original, "owner/repo/skill-b", newEntry);

		expect(original).toEqual(originalCopy);
		expect(result).not.toBe(original);
	});
});

describe("removeEntry", () => {
	it("returns manifest without the specified key, preserves other entries", () => {
		const entryA: ManifestEntry = {
			ref: "main",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill-a/"],
			cloneUrl: null,
		};
		const entryB: ManifestEntry = {
			ref: "v2",
			commit: "def456",
			installedAt: "2026-01-16T10:00:00.000Z",
			agents: ["codex"],
			files: [".codex/skills/skill-b/"],
			cloneUrl: null,
		};
		const manifest: Manifest = {
			"owner/repo/skill-a": entryA,
			"owner/repo/skill-b": entryB,
		};

		const result = removeEntry(manifest, "owner/repo/skill-a");

		expect(result).toEqual({ "owner/repo/skill-b": entryB });
		expect(result["owner/repo/skill-a"]).toBeUndefined();
	});

	it("returns manifest unchanged when key does not exist", () => {
		const entry: ManifestEntry = {
			ref: "main",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};
		const manifest: Manifest = { "owner/repo/skill": entry };

		const result = removeEntry(manifest, "nonexistent/key");

		expect(result).toEqual(manifest);
	});

	it("does not mutate input", () => {
		const entry: ManifestEntry = {
			ref: "main",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};
		const manifest: Manifest = { "owner/repo/skill": entry };
		const copy = JSON.parse(JSON.stringify(manifest)) as Manifest;

		const result = removeEntry(manifest, "owner/repo/skill");

		expect(manifest).toEqual(copy);
		expect(result).not.toBe(manifest);
	});
});

describe("round-trip", () => {
	it("write then read returns same data", async () => {
		const manifest: Manifest = {
			"owner/repo/skill-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
				cloneUrl: "https://github.com/owner/repo.git",
				type: "skill",
			},
			"owner/repo/skill-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/skill-b/", ".codex/skills/skill-b/"],
				cloneUrl: null,
				type: "skill",
			},
		};

		await writeManifest(testDir, manifest);
		const result = await readManifest(testDir);
		expect(result).toEqual(manifest);
	});
});

describe("ManifestEntry fields", () => {
	it("stores null ref for HEAD, string commit, ISO timestamp, agent array, file array", () => {
		const entry: ManifestEntry = {
			ref: null,
			commit: "abc123def456",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude", "codex"],
			files: [".claude/skills/skill/", ".codex/skills/skill/"],
			cloneUrl: null,
		};

		expect(entry.ref).toBeNull();
		expect(typeof entry.commit).toBe("string");
		expect(entry.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(Array.isArray(entry.agents)).toBe(true);
		expect(Array.isArray(entry.files)).toBe(true);
	});

	it("stores cloneUrl as string for remote installs", () => {
		const entry: ManifestEntry = {
			ref: "main",
			commit: "abc123def456",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: "https://gitlab.com/owner/repo.git",
		};

		expect(entry.cloneUrl).toBe("https://gitlab.com/owner/repo.git");
	});

	it("stores cloneUrl as null for local installs", () => {
		const entry: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		expect(entry.cloneUrl).toBeNull();
	});
});

describe("constraint field", () => {
	it("ManifestEntry accepts optional constraint field", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
			constraint: "^1.0",
		};

		expect(entry.constraint).toBe("^1.0");
	});

	it("ManifestEntry without constraint has undefined constraint", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		expect(entry.constraint).toBeUndefined();
	});

	it("write/read round-trip preserves constraint field", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "v1.2.3",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
				constraint: "^1.0",
			},
		};

		await writeManifest(testDir, manifest);
		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]?.constraint).toBe("^1.0");
	});

	it("old manifest without constraint field reads correctly", async () => {
		const oldManifest = {
			"owner/repo/skill": {
				ref: "v1.2.3",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(oldManifest),
		);

		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]?.constraint).toBeUndefined();
	});

	it("JSON serialization omits undefined constraint", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		const json = JSON.stringify(entry);

		expect(json).not.toContain("constraint");
	});

	it("JSON serialization includes defined constraint", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
			constraint: "^1.0",
		};

		const parsed = JSON.parse(JSON.stringify(entry));

		expect(parsed.constraint).toBe("^1.0");
	});
});

describe("type field", () => {
	it("ManifestEntry accepts optional type field", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
			type: "skill",
		};

		expect(entry.type).toBe("skill");
	});

	it("ManifestEntry without type has undefined type", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		expect(entry.type).toBeUndefined();
	});

	it("write/read round-trip preserves type field", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "v1.2.3",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
				type: "plugin",
			},
		};

		await writeManifest(testDir, manifest);
		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]?.type).toBe("plugin");
	});

	it("legacy entry without type field still parses", async () => {
		const legacyManifest = {
			"owner/repo/skill": {
				ref: "v1.2.3",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(legacyManifest),
		);

		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]).toBeDefined();
	});

	it("JSON serialization omits undefined type", () => {
		const entry: ManifestEntry = {
			ref: "v1.2.3",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/skill/"],
			cloneUrl: null,
		};

		const json = JSON.stringify(entry);

		expect(json).not.toContain("type");
	});
});

describe("manifestTypeFromDetected", () => {
	it("maps bare-skill to skill", () => {
		expect(manifestTypeFromDetected("bare-skill")).toBe("skill");
	});

	it("maps plugin to plugin", () => {
		expect(manifestTypeFromDetected("plugin")).toBe("plugin");
	});

	it("never returns the literal bare-skill", () => {
		expect(manifestTypeFromDetected("bare-skill")).not.toBe("bare-skill");
	});
});

describe("type backfill on read", () => {
	async function writeLegacy(
		manifest: Record<string, Record<string, unknown>>,
	): Promise<void> {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(manifest),
		);
	}

	it("backfills plugin when files include agents target", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/thing/", ".claude/agents/thing.md"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("plugin");
	});

	it("backfills plugin when files include hooks target", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/hooks/my-hook.json"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("plugin");
	});

	it("backfills plugin for multiple distinct skill dirs under one key", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/", ".claude/skills/skill-b/"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("plugin");
	});

	it("backfills skill for single skills dir, no agents/hooks (single-skill ambiguity accepted)", async () => {
		await writeLegacy({
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/SKILL.md", ".claude/skills/skill/ref.md"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]?.type).toBe("skill");
	});

	it("does not overwrite existing type", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/a/", ".claude/skills/b/"],
				cloneUrl: null,
				type: "skill",
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("skill");
	});

	it("recognises per-agent skills targets (claude, codex, cursor)", async () => {
		await writeLegacy({
			"owner/repo/claude-skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/claude-skill/"],
				cloneUrl: null,
			},
			"owner/repo/codex-skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["codex"],
				files: [".agents/skills/codex-skill/"],
				cloneUrl: null,
			},
			"owner/repo/cursor-skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["cursor"],
				files: [".cursor/skills/cursor-skill/"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo/claude-skill"]?.type).toBe("skill");
		expect(result["owner/repo/codex-skill"]?.type).toBe("skill");
		expect(result["owner/repo/cursor-skill"]?.type).toBe("skill");
	});

	it("treats same skill dir across multiple agent targets as single skill", async () => {
		await writeLegacy({
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/skill/", ".agents/skills/skill/"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]?.type).toBe("skill");
	});

	it("backfills empty files array to skill without error", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("skill");
	});

	it("backfills all-unrecognised files to skill without error", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: ["some/random/path.md", "another/file.txt"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.type).toBe("skill");
	});

	it("reading legacy manifest with no type never errors", async () => {
		await writeLegacy({
			"owner/repo/a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/a/"],
				cloneUrl: null,
			},
			"owner/repo/b": {
				ref: "main",
				commit: "def456",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/b/", ".claude/agents/b.md"],
				cloneUrl: null,
			},
		});

		await expect(readManifest(testDir)).resolves.toBeDefined();
	});

	it("backfills legacy collection-member entry from its own files (never collection)", async () => {
		await writeLegacy({
			"owner/repo/member-skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/member-skill/"],
				cloneUrl: null,
			},
			"owner/repo/member-plugin": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [
					".claude/skills/member-plugin/",
					".claude/agents/member-agent.md",
				],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo/member-skill"]?.type).toBe("skill");
		expect(result["owner/repo/member-plugin"]?.type).toBe("plugin");
	});

	it("backfilled type persists on next writeManifest", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/a/", ".claude/skills/b/"],
				cloneUrl: null,
			},
		});

		const result = await readManifest(testDir);
		await writeManifest(testDir, result);

		const content = await readFile(
			join(testDir, ".agntc", "manifest.json"),
			"utf-8",
		);
		const reparsed = JSON.parse(content) as Manifest;
		expect(reparsed["owner/repo"]?.type).toBe("plugin");
	});

	it("backfills cloneUrl and type together", async () => {
		await writeLegacy({
			"owner/repo": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/a/", ".claude/skills/b/"],
			},
		});

		const result = await readManifest(testDir);

		expect(result["owner/repo"]?.cloneUrl).toBeNull();
		expect(result["owner/repo"]?.type).toBe("plugin");
	});
});

describe("backward compatibility", () => {
	it("defaults cloneUrl to null when reading manifest without cloneUrl field", async () => {
		const oldManifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(oldManifest),
		);

		const result = await readManifest(testDir);

		expect(result["owner/repo/skill"]!.cloneUrl).toBeNull();
	});
});

describe("readManifestOrExit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns manifest when readManifest succeeds", async () => {
		const manifest: Manifest = {
			"owner/repo/skill": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill/"],
				cloneUrl: null,
				type: "skill",
			},
		};
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(
			join(testDir, ".agntc", "manifest.json"),
			JSON.stringify(manifest),
		);

		const result = await readManifestOrExit(testDir);

		expect(result).toEqual(manifest);
	});

	it("throws ExitSignal(1) when manifest cannot be read", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(join(testDir, ".agntc", "manifest.json"), "{bad json}");

		const err = await readManifestOrExit(testDir).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect((err as ExitSignal).code).toBe(1);
	});

	it("logs error message with 'Failed to read manifest:' prefix", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		await writeFile(join(testDir, ".agntc", "manifest.json"), "{bad json}");

		await readManifestOrExit(testDir).catch(() => {});

		expect(mockLog.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to read manifest:"),
		);
	});

	it("includes the underlying error message in the log", async () => {
		await mkdir(join(testDir, ".agntc"), { recursive: true });
		const manifestPath = join(testDir, ".agntc", "manifest.json");
		await writeFile(manifestPath, "{}");
		await chmod(manifestPath, 0o000);

		try {
			await readManifestOrExit(testDir).catch(() => {});

			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringMatching(/Failed to read manifest:.*permission/i),
			);
		} finally {
			await chmod(manifestPath, 0o644);
		}
	});

	it("returns empty object for missing manifest (ENOENT)", async () => {
		const result = await readManifestOrExit(join(testDir, "nonexistent"));

		expect(result).toEqual({});
	});
});

describe("buildManifestEntry", () => {
	const FIXED = "2026-01-01T00:00:00.000Z";

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(FIXED));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stamps installedAt from the clock at call time", () => {
		const entry = buildManifestEntry({
			ref: "v1.0.0",
			commit: "abc123",
			agents: ["claude"],
			files: ["a.md"],
			type: "skill",
			cloneUrl: "https://example.com/repo.git",
		});

		expect(entry.installedAt).toBe(FIXED);
	});

	it("installedAt is a valid ISO string", () => {
		const entry = buildManifestEntry({
			ref: null,
			commit: null,
			agents: ["claude"],
			files: [],
			type: "plugin",
			cloneUrl: null,
		});

		expect(new Date(entry.installedAt).toISOString()).toBe(entry.installedAt);
	});

	it("includes constraint when provided", () => {
		const entry = buildManifestEntry({
			ref: "v2.0.0",
			commit: "sha",
			agents: ["claude", "codex"],
			files: ["x"],
			type: "plugin",
			cloneUrl: "https://example.com/repo.git",
			constraint: "^2.0.0",
		});

		expect(entry).toEqual({
			ref: "v2.0.0",
			commit: "sha",
			installedAt: FIXED,
			agents: ["claude", "codex"],
			files: ["x"],
			type: "plugin",
			cloneUrl: "https://example.com/repo.git",
			constraint: "^2.0.0",
		});
		expect("constraint" in entry).toBe(true);
	});

	it("omits constraint when undefined", () => {
		const entry = buildManifestEntry({
			ref: "v2.0.0",
			commit: "sha",
			agents: ["claude"],
			files: ["x"],
			type: "plugin",
			cloneUrl: null,
			constraint: undefined,
		});

		expect("constraint" in entry).toBe(false);
		expect(entry).toEqual({
			ref: "v2.0.0",
			commit: "sha",
			installedAt: FIXED,
			agents: ["claude"],
			files: ["x"],
			type: "plugin",
			cloneUrl: null,
		});
	});

	it("omits constraint when the field is not passed at all", () => {
		const entry = buildManifestEntry({
			ref: null,
			commit: null,
			agents: ["claude"],
			files: [],
			type: "skill",
			cloneUrl: null,
		});

		expect("constraint" in entry).toBe(false);
	});

	it("supports local (commit null) entries with a sha distinct from null", () => {
		const local = buildManifestEntry({
			ref: null,
			commit: null,
			agents: ["claude"],
			files: ["s"],
			type: "skill",
			cloneUrl: null,
		});
		const remote = buildManifestEntry({
			ref: "v1.0.0",
			commit: "deadbeef",
			agents: ["claude"],
			files: ["s"],
			type: "skill",
			cloneUrl: "https://example.com/repo.git",
		});

		expect(local.commit).toBeNull();
		expect(remote.commit).toBe("deadbeef");
	});
});
