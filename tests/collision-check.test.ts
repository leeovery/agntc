import { describe, expect, it } from "vitest";
import { checkFileCollisions } from "../src/collision-check.js";
import type { Manifest } from "../src/manifest.js";

describe("checkFileCollisions", () => {
	it("returns empty map when no overlap", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};

		const result = checkFileCollisions([".claude/skills/skill-b/"], manifest);

		expect(result.size).toBe(0);
	});

	it("returns empty map when manifest is empty", () => {
		const result = checkFileCollisions([".claude/skills/skill-a/"], {});

		expect(result.size).toBe(0);
	});

	it("detects single file overlap with one plugin", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/shared-skill/"],
			},
		};

		const result = checkFileCollisions(
			[".claude/skills/shared-skill/"],
			manifest,
		);

		expect(result.size).toBe(1);
		expect(result.get("owner/repo-a")).toEqual([
			".claude/skills/shared-skill/",
		]);
	});

	it("detects multiple file overlaps with one plugin", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [
					".claude/skills/planning/",
					".claude/agents/executor.md",
					".claude/hooks/pre-commit.sh",
				],
			},
		};

		const result = checkFileCollisions(
			[".claude/skills/planning/", ".claude/agents/executor.md"],
			manifest,
		);

		expect(result.size).toBe(1);
		expect(result.get("owner/repo-a")).toEqual([
			".claude/skills/planning/",
			".claude/agents/executor.md",
		]);
	});

	it("groups collisions by manifest key across multiple plugins", () => {
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
		};

		const result = checkFileCollisions(
			[".claude/skills/skill-a/", ".claude/agents/my-agent.md"],
			manifest,
		);

		expect(result.size).toBe(2);
		expect(result.get("owner/repo-a")).toEqual([".claude/skills/skill-a/"]);
		expect(result.get("owner/repo-b")).toEqual([".claude/agents/my-agent.md"]);
	});

	it("excludes own key for reinstall", () => {
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
				files: [".claude/skills/skill-b/"],
			},
		};

		const result = checkFileCollisions(
			[".claude/skills/skill-a/"],
			manifest,
			"owner/repo-a",
		);

		expect(result.size).toBe(0);
	});

	it("excludes own key but still detects collisions with other plugins", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/", ".claude/skills/shared/"],
			},
			"owner/repo-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/shared/"],
			},
		};

		const result = checkFileCollisions(
			[".claude/skills/skill-a/", ".claude/skills/shared/"],
			manifest,
			"owner/repo-a",
		);

		expect(result.size).toBe(1);
		expect(result.get("owner/repo-b")).toEqual([".claude/skills/shared/"]);
	});

	it("matches directory paths exactly (no partial prefix matching)", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			},
		};

		// "my-skill-extended/" should NOT match "my-skill/"
		const result = checkFileCollisions(
			[".claude/skills/my-skill-extended/"],
			manifest,
		);

		expect(result.size).toBe(0);
	});

	it("matches regular file paths exactly", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/agents/executor.md"],
			},
		};

		// Different file should not match
		const result = checkFileCollisions(
			[".claude/agents/executor.md.bak"],
			manifest,
		);

		expect(result.size).toBe(0);
	});

	it("returns empty map when incoming files list is empty", () => {
		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			},
		};

		const result = checkFileCollisions([], manifest);

		expect(result.size).toBe(0);
	});
});
