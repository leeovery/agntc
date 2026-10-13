import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../src/manifest.js";
import { checkUnmanagedConflicts } from "../src/unmanaged-check.js";

let projectDir: string;

beforeEach(async () => {
	projectDir = await mkdtemp(join(tmpdir(), "unmanaged-check-"));
});

afterEach(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

describe("checkUnmanagedConflicts", () => {
	it("returns empty when no files exist on disk", async () => {
		const result = await checkUnmanagedConflicts(
			[".claude/skills/my-skill/", ".claude/agents/executor.md"],
			{},
			projectDir,
		);

		expect(result).toEqual([]);
	});

	it("returns empty when all existing files are manifest-tracked", async () => {
		// Create files on disk
		await mkdir(join(projectDir, ".claude/skills/my-skill"), {
			recursive: true,
		});

		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/my-skill/"],
			},
		};

		const result = await checkUnmanagedConflicts(
			[".claude/skills/my-skill/"],
			manifest,
			projectDir,
		);

		expect(result).toEqual([]);
	});

	it("detects unmanaged skill directory", async () => {
		await mkdir(join(projectDir, ".claude/skills/my-skill"), {
			recursive: true,
		});

		const result = await checkUnmanagedConflicts(
			[".claude/skills/my-skill/"],
			{},
			projectDir,
		);

		expect(result).toEqual([".claude/skills/my-skill/"]);
	});

	it("detects unmanaged agent file", async () => {
		await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		await writeFile(join(projectDir, ".claude/agents/executor.md"), "# Agent");

		const result = await checkUnmanagedConflicts(
			[".claude/agents/executor.md"],
			{},
			projectDir,
		);

		expect(result).toEqual([".claude/agents/executor.md"]);
	});

	it("detects unmanaged hook file", async () => {
		await mkdir(join(projectDir, ".claude/hooks"), { recursive: true });
		await writeFile(
			join(projectDir, ".claude/hooks/pre-commit.sh"),
			"#!/bin/bash",
		);

		const result = await checkUnmanagedConflicts(
			[".claude/hooks/pre-commit.sh"],
			{},
			projectDir,
		);

		expect(result).toEqual([".claude/hooks/pre-commit.sh"]);
	});

	it("detects empty directory as conflict", async () => {
		// Empty dir still counts as a conflict
		await mkdir(join(projectDir, ".claude/skills/empty-skill"), {
			recursive: true,
		});

		const result = await checkUnmanagedConflicts(
			[".claude/skills/empty-skill/"],
			{},
			projectDir,
		);

		expect(result).toEqual([".claude/skills/empty-skill/"]);
	});

	it("detects mixed asset-level conflicts", async () => {
		await mkdir(join(projectDir, ".claude/skills/planning"), {
			recursive: true,
		});
		await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		await writeFile(join(projectDir, ".claude/agents/executor.md"), "# Agent");
		await mkdir(join(projectDir, ".claude/hooks"), { recursive: true });
		await writeFile(
			join(projectDir, ".claude/hooks/pre-commit.sh"),
			"#!/bin/bash",
		);

		const result = await checkUnmanagedConflicts(
			[
				".claude/skills/planning/",
				".claude/agents/executor.md",
				".claude/hooks/pre-commit.sh",
			],
			{},
			projectDir,
		);

		expect(result).toEqual([
			".claude/skills/planning/",
			".claude/agents/executor.md",
			".claude/hooks/pre-commit.sh",
		]);
	});

	it("excludes files tracked by any manifest entry", async () => {
		// skill-a is tracked by repo-a, skill-b is unmanaged
		await mkdir(join(projectDir, ".claude/skills/skill-a"), {
			recursive: true,
		});
		await mkdir(join(projectDir, ".claude/skills/skill-b"), {
			recursive: true,
		});

		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			},
		};

		const result = await checkUnmanagedConflicts(
			[".claude/skills/skill-a/", ".claude/skills/skill-b/"],
			manifest,
			projectDir,
		);

		expect(result).toEqual([".claude/skills/skill-b/"]);
	});

	it("counts a tracked folder as tracked when the incoming path has no trailing slash", async () => {
		await mkdir(join(projectDir, ".claude/hooks/x"), { recursive: true });
		await writeFile(join(projectDir, ".claude/hooks/x/a.sh"), "#!/bin/bash");
		const manifest: Manifest = {
			"owner/repo/p": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/hooks/x/", ".claude/hooks/x/a.sh"],
				type: "pack",
			},
		};

		const result = await checkUnmanagedConflicts(
			[".claude/hooks/x"],
			manifest,
			projectDir,
		);

		expect(result).toEqual([]);
	});

	it("counts a tracked file as tracked when the incoming path names it as a folder", async () => {
		await mkdir(join(projectDir, ".claude/hooks"), { recursive: true });
		await writeFile(join(projectDir, ".claude/hooks/x"), "#!/bin/bash");
		const manifest: Manifest = {
			"owner/repo/p": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/hooks/x"],
				type: "pack",
			},
		};

		const result = await checkUnmanagedConflicts(
			[".claude/hooks/x/"],
			manifest,
			projectDir,
		);

		expect(result).toEqual([]);
	});

	it("collects tracked files from all manifest entries", async () => {
		await mkdir(join(projectDir, ".claude/skills/skill-a"), {
			recursive: true,
		});
		await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		await writeFile(join(projectDir, ".claude/agents/executor.md"), "# Agent");

		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			},
			"owner/repo-b": {
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				files: [".claude/agents/executor.md"],
			},
		};

		const result = await checkUnmanagedConflicts(
			[".claude/skills/skill-a/", ".claude/agents/executor.md"],
			manifest,
			projectDir,
		);

		expect(result).toEqual([]);
	});

	it("returns empty when incoming files list is empty", async () => {
		const result = await checkUnmanagedConflicts([], {}, projectDir);

		expect(result).toEqual([]);
	});

	it("only reports files that exist on disk AND are untracked", async () => {
		// skill-a exists on disk, untracked -> conflict
		// skill-b does NOT exist on disk -> no conflict
		// agent exists on disk, tracked -> no conflict
		await mkdir(join(projectDir, ".claude/skills/skill-a"), {
			recursive: true,
		});
		await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		await writeFile(join(projectDir, ".claude/agents/executor.md"), "# Agent");

		const manifest: Manifest = {
			"owner/repo-a": {
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/agents/executor.md"],
			},
		};

		const result = await checkUnmanagedConflicts(
			[
				".claude/skills/skill-a/",
				".claude/skills/skill-b/",
				".claude/agents/executor.md",
			],
			manifest,
			projectDir,
		);

		expect(result).toEqual([".claude/skills/skill-a/"]);
	});

	describe("symlinks", () => {
		let realDir: string;

		beforeEach(async () => {
			realDir = join(projectDir, "my-own");
			await mkdir(realDir);
			await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
			await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		});

		it("reports a link at the target as in the way", async () => {
			await symlink(realDir, join(projectDir, ".claude/skills/foo"));

			const result = await checkUnmanagedConflicts(
				[".claude/skills/foo/"],
				{},
				projectDir,
			);

			expect(result).toEqual([".claude/skills/foo/"]);
		});

		it("reports a dangling link at the target as in the way", async () => {
			await symlink(
				join(projectDir, "gone"),
				join(projectDir, ".claude/skills/foo"),
			);

			const result = await checkUnmanagedConflicts(
				[".claude/skills/foo/"],
				{},
				projectDir,
			);

			expect(result).toEqual([".claude/skills/foo/"]);
		});

		it("reports a linked folder above incoming agents once, in their place", async () => {
			await symlink(realDir, join(projectDir, ".claude/agents/team"));

			const result = await checkUnmanagedConflicts(
				[".claude/agents/team/lead.md", ".claude/agents/team/qa.md"],
				{},
				projectDir,
			);

			expect(result).toEqual([".claude/agents/team"]);
		});

		it("leaves a link the manifest records to the collision check", async () => {
			await symlink(realDir, join(projectDir, ".claude/skills/foo"));
			const manifest: Manifest = {
				"owner/repo-a": {
					ref: "main",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/foo/"],
				},
			};

			const result = await checkUnmanagedConflicts(
				[".claude/skills/foo/"],
				manifest,
				projectDir,
			);

			expect(result).toEqual([]);
		});
	});
});
