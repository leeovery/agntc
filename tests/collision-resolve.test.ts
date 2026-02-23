import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/manifest.js";

// Mock @clack/prompts before importing module under test
vi.mock("@clack/prompts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@clack/prompts")>();
	return {
		...actual,
		select: vi.fn(),
		isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
	};
});

// Mock nukeManifestFiles
vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn().mockResolvedValue({ removed: [], skipped: [] }),
}));

import * as p from "@clack/prompts";
import { resolveCollisions } from "../src/collision-resolve.js";
import { nukeManifestFiles } from "../src/nuke-files.js";

const mockedSelect = vi.mocked(p.select);
const mockedNuke = vi.mocked(nukeManifestFiles);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("resolveCollisions", () => {
	it("returns resolved true with unchanged manifest when no collisions", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};
		const collisions = new Map<string, string[]>();

		const result = await resolveCollisions(collisions, manifest, "/project");

		expect(result.resolved).toBe(true);
		expect(result.updatedManifest).toEqual(manifest);
		expect(mockedSelect).not.toHaveBeenCalled();
	});

	it("removes colliding plugin when user chooses remove", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/", ".claude/agents/executor.md"],
			},
			"owner/repo-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		mockedSelect.mockResolvedValueOnce("remove");

		const result = await resolveCollisions(collisions, manifest, "/project");

		expect(result.resolved).toBe(true);
		// repo-a should be removed from manifest
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		// repo-b should remain
		expect(result.updatedManifest["owner/repo-b"]).toEqual(
			manifest["owner/repo-b"],
		);
		// nukeManifestFiles should have been called with all files from repo-a
		expect(mockedNuke).toHaveBeenCalledWith("/project", [
			".claude/skills/skill-a/",
			".claude/agents/executor.md",
		]);
	});

	it("returns resolved false when user chooses cancel", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveCollisions(collisions, manifest, "/project");

		expect(result.resolved).toBe(false);
		// Manifest unchanged
		expect(result.updatedManifest).toEqual(manifest);
		expect(mockedNuke).not.toHaveBeenCalled();
	});

	it("resolves multiple colliding plugins sequentially", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
			"owner/repo-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/agents/my-agent.md"],
			},
			"owner/repo-c": {
				ref: "v1",
				commit: "ghi789",
				installedAt: "2026-01-17T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-c/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
			["owner/repo-b", [".claude/agents/my-agent.md"]],
		]);

		// User removes both
		mockedSelect.mockResolvedValueOnce("remove");
		mockedSelect.mockResolvedValueOnce("remove");

		const result = await resolveCollisions(collisions, manifest, "/project");

		expect(result.resolved).toBe(true);
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		expect(result.updatedManifest["owner/repo-b"]).toBeUndefined();
		expect(result.updatedManifest["owner/repo-c"]).toEqual(
			manifest["owner/repo-c"],
		);
		expect(mockedSelect).toHaveBeenCalledTimes(2);
		expect(mockedNuke).toHaveBeenCalledTimes(2);
	});

	it("stops on cancel during sequential resolution", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
			"owner/repo-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/agents/my-agent.md"],
			},
			"owner/repo-c": {
				ref: "v1",
				commit: "ghi789",
				installedAt: "2026-01-17T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-c/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
			["owner/repo-b", [".claude/agents/my-agent.md"]],
		]);

		// User removes first but cancels second
		mockedSelect.mockResolvedValueOnce("remove");
		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveCollisions(collisions, manifest, "/project");

		// Cancel stops everything
		expect(result.resolved).toBe(false);
		// First plugin was already removed
		expect(mockedNuke).toHaveBeenCalledTimes(1);
		expect(mockedSelect).toHaveBeenCalledTimes(2);
		// repo-a was already nuked from disk, so manifest must reflect its removal
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		// repo-b cancel happened before processing — still present
		expect(result.updatedManifest["owner/repo-b"]).toEqual(
			manifest["owner/repo-b"],
		);
		// Non-colliding entry preserved
		expect(result.updatedManifest["owner/repo-c"]).toEqual(
			manifest["owner/repo-c"],
		);
	});

	it("treats clack cancel (symbol) as cancel", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		// Clack returns symbol when user presses Ctrl+C
		mockedSelect.mockResolvedValueOnce(Symbol("cancel") as unknown as string);

		const result = await resolveCollisions(collisions, manifest, "/project");

		expect(result.resolved).toBe(false);
		expect(mockedNuke).not.toHaveBeenCalled();
	});

	it("does not offer install-anyway option", async () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		mockedSelect.mockResolvedValueOnce("cancel");

		await resolveCollisions(collisions, manifest, "/project");

		// Verify the options passed to select do NOT include "install-anyway"
		const call = mockedSelect.mock.calls[0]!;
		const options = (call[0] as { options: Array<{ value: string }> }).options;
		const values = options.map((o) => o.value);
		expect(values).not.toContain("install-anyway");
		expect(values).toContain("remove");
		expect(values).toContain("cancel");
	});
});
