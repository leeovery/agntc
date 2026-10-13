import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeIncomingFiles } from "../src/compute-incoming-files.js";

describe("computeIncomingFiles", () => {
	describe("bare-skill", () => {
		it("computes the .claude/skills target path", async () => {
			const result = await computeIncomingFiles({
				type: "bare-skill",
				sourceDir: "/tmp/my-skill",
			});

			expect(result).toEqual([".claude/skills/my-skill/"]);
		});

		// Regression: a whole-repo bare skill's sourceDir is the random clone dir,
		// so the destination path must come from the explicit skillName, not
		// basename(sourceDir) — otherwise the collision check targets the wrong dir.
		it("uses skillName over basename(sourceDir) when provided", async () => {
			const result = await computeIncomingFiles({
				type: "bare-skill",
				sourceDir: "/tmp/agntc-Xy12ab", // mkdtemp clone root
				skillName: "refero-design",
			});

			expect(result).toEqual([".claude/skills/refero-design/"]);
		});

		it("uses basename of sourceDir as skill name", async () => {
			const result = await computeIncomingFiles({
				type: "bare-skill",
				sourceDir: "/some/deep/path/planning-skill",
			});

			expect(result).toEqual([".claude/skills/planning-skill/"]);
		});
	});

	describe("plugin", () => {
		let sourceDir: string;

		beforeEach(async () => {
			sourceDir = await mkdtemp(join(tmpdir(), "compute-incoming-"));
		});

		afterEach(async () => {
			await rm(sourceDir, { recursive: true, force: true });
		});

		it("enumerates individual skill directories", async () => {
			await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
			await writeFile(
				join(sourceDir, "skills/planning/SKILL.md"),
				"# Planning",
			);
			await mkdir(join(sourceDir, "skills/review"), { recursive: true });
			await writeFile(join(sourceDir, "skills/review/SKILL.md"), "# Review");

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["skills"],
			});

			expect(result).toEqual(
				expect.arrayContaining([
					".claude/skills/planning/",
					".claude/skills/review/",
				]),
			);
			expect(result).toHaveLength(2);
		});

		it("enumerates individual agent files", async () => {
			await mkdir(join(sourceDir, "agents"), { recursive: true });
			await writeFile(join(sourceDir, "agents/executor.md"), "# Executor");

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["agents"],
			});

			expect(result).toEqual([".claude/agents/executor.md"]);
		});

		it("enumerates individual hook files", async () => {
			await mkdir(join(sourceDir, "hooks"), { recursive: true });
			await writeFile(join(sourceDir, "hooks/pre-commit.sh"), "#!/bin/bash");

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["hooks"],
			});

			expect(result).toEqual([".claude/hooks/pre-commit.sh"]);
		});

		it("enumerates all asset types together", async () => {
			await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
			await writeFile(
				join(sourceDir, "skills/planning/SKILL.md"),
				"# Planning",
			);
			await mkdir(join(sourceDir, "skills/review"), { recursive: true });
			await writeFile(join(sourceDir, "skills/review/SKILL.md"), "# Review");
			await mkdir(join(sourceDir, "agents"), { recursive: true });
			await writeFile(join(sourceDir, "agents/executor.md"), "# Executor");
			await mkdir(join(sourceDir, "hooks"), { recursive: true });
			await writeFile(join(sourceDir, "hooks/pre-commit.sh"), "#!/bin/bash");

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["skills", "agents", "hooks"],
			});

			expect(result).toEqual(
				expect.arrayContaining([
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
					".claude/hooks/pre-commit.sh",
				]),
			);
			expect(result).toHaveLength(4);
		});

		it("returns empty array when source asset dir is empty", async () => {
			await mkdir(join(sourceDir, "skills"), { recursive: true });

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["skills"],
			});

			expect(result).toEqual([]);
		});

		it("returns empty array when source asset dir does not exist", async () => {
			// sourceDir exists but skills/ does not

			const result = await computeIncomingFiles({
				type: "plugin",
				sourceDir,
				assetDirs: ["skills"],
			});

			expect(result).toEqual([]);
		});
	});

	describe("edge cases", () => {
		it("returns empty array for plugin with no asset dirs", async () => {
			const sourceDir = await mkdtemp(join(tmpdir(), "compute-incoming-"));
			try {
				const result = await computeIncomingFiles({
					type: "plugin",
					sourceDir,
					assetDirs: [],
				});

				expect(result).toEqual([]);
			} finally {
				await rm(sourceDir, { recursive: true, force: true });
			}
		});
	});
});
