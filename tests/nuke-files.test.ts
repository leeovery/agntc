import {
	access,
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nukeManifestFiles } from "../src/nuke-files.js";

let testDir: string;
let projectDir: string;

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "agntc-nuke-test-"));
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe("nukeManifestFiles", () => {
	it("removes individual files", async () => {
		const filePath = ".claude/skills/my-skill/SKILL.md";
		await mkdir(join(projectDir, ".claude/skills/my-skill"), {
			recursive: true,
		});
		await writeFile(join(projectDir, filePath), "content");

		const result = await nukeManifestFiles(projectDir, [filePath]);

		expect(await fileExists(join(projectDir, filePath))).toBe(false);
		expect(result.removed).toEqual([filePath]);
		expect(result.skipped).toEqual([]);
	});

	it("removes directories recursively", async () => {
		const dirPath = ".claude/skills/my-skill/";
		await mkdir(join(projectDir, ".claude/skills/my-skill"), {
			recursive: true,
		});
		await writeFile(
			join(projectDir, ".claude/skills/my-skill/SKILL.md"),
			"content",
		);
		await mkdir(join(projectDir, ".claude/skills/my-skill/references"), {
			recursive: true,
		});
		await writeFile(
			join(projectDir, ".claude/skills/my-skill/references/guide.md"),
			"guide",
		);

		const result = await nukeManifestFiles(projectDir, [dirPath]);

		expect(await fileExists(join(projectDir, ".claude/skills/my-skill"))).toBe(
			false,
		);
		expect(result.removed).toEqual([dirPath]);
		expect(result.skipped).toEqual([]);
	});

	it("skips ENOENT silently", async () => {
		const missingFile = ".claude/skills/gone/SKILL.md";

		const result = await nukeManifestFiles(projectDir, [missingFile]);

		expect(result.removed).toEqual([]);
		expect(result.skipped).toEqual([missingFile]);
	});

	it("returns removed and skipped lists", async () => {
		const existingFile = ".claude/skills/my-skill/SKILL.md";
		const missingFile = ".claude/skills/gone/SKILL.md";
		await mkdir(join(projectDir, ".claude/skills/my-skill"), {
			recursive: true,
		});
		await writeFile(join(projectDir, existingFile), "content");

		const result = await nukeManifestFiles(projectDir, [
			existingFile,
			missingFile,
		]);

		expect(result.removed).toEqual([existingFile]);
		expect(result.skipped).toEqual([missingFile]);
	});

	it("propagates EACCES", async () => {
		const dirPath = ".claude/skills/locked/";
		const lockedDir = join(projectDir, ".claude/skills/locked");
		await mkdir(lockedDir, { recursive: true });
		await writeFile(join(lockedDir, "SKILL.md"), "content");

		// Lock the parent directory to prevent deletion
		const parentDir = join(projectDir, ".claude/skills");
		await chmod(parentDir, 0o444);

		try {
			await expect(
				nukeManifestFiles(projectDir, [dirPath]),
			).rejects.toMatchObject({ code: "EACCES" });
		} finally {
			await chmod(parentDir, 0o755);
		}
	});

	it("empty files array is no-op", async () => {
		const result = await nukeManifestFiles(projectDir, []);

		expect(result.removed).toEqual([]);
		expect(result.skipped).toEqual([]);
	});

	it("handles mix of existing and missing entries", async () => {
		const existingDir = ".claude/skills/skill-a/";
		const existingFile = ".claude/agents/reviewer/agent.md";
		const missingDir = ".claude/skills/skill-b/";
		const missingFile = ".claude/skills/gone.md";

		await mkdir(join(projectDir, ".claude/skills/skill-a"), {
			recursive: true,
		});
		await writeFile(
			join(projectDir, ".claude/skills/skill-a/SKILL.md"),
			"content",
		);
		await mkdir(join(projectDir, ".claude/agents/reviewer"), {
			recursive: true,
		});
		await writeFile(
			join(projectDir, ".claude/agents/reviewer/agent.md"),
			"content",
		);

		const result = await nukeManifestFiles(projectDir, [
			existingDir,
			existingFile,
			missingDir,
			missingFile,
		]);

		expect(result.removed).toEqual([existingDir, existingFile]);
		expect(result.skipped).toEqual([missingDir, missingFile]);
		expect(await fileExists(join(projectDir, ".claude/skills/skill-a"))).toBe(
			false,
		);
		expect(
			await fileExists(join(projectDir, ".claude/agents/reviewer/agent.md")),
		).toBe(false);
	});

	describe("a recorded path that isn't plainly below the project", () => {
		it("is left alone while the rest go, then the call fails naming it", async () => {
			await writeFile(join(testDir, "outside.md"), "keep");
			await mkdir(join(projectDir, ".claude/skills/kept/"), {
				recursive: true,
			});
			await mkdir(join(projectDir, ".claude/skills/gone/"), {
				recursive: true,
			});

			await expect(
				nukeManifestFiles(projectDir, [
					"../outside.md",
					".claude/skills/kept/..",
					join(testDir, "outside.md"),
					".claude/skills/gone/",
				]),
			).rejects.toThrow(
				`won't delete ../outside.md, .claude/skills/kept/.., ${join(testDir, "outside.md")} — not a plain path below ${projectDir}`,
			);

			expect(await readFile(join(testDir, "outside.md"), "utf-8")).toBe("keep");
			expect(await fileExists(join(projectDir, ".claude/skills/kept"))).toBe(
				true,
			);
			expect(await fileExists(join(projectDir, ".claude/skills/gone"))).toBe(
				false,
			);
		});

		it.each([
			"",
			".",
			"./",
			".claude/./skills/x/",
		])("refuses %j", async (path) => {
			await expect(nukeManifestFiles(projectDir, [path])).rejects.toThrow(
				"not a plain path below",
			);
			expect(await fileExists(projectDir)).toBe(true);
		});
	});

	describe("symlinks", () => {
		let realDir: string;

		beforeEach(async () => {
			realDir = join(testDir, "my-own-skill");
			await mkdir(join(realDir, "references"), { recursive: true });
			await writeFile(join(realDir, "SKILL.md"), "mine");
			await writeFile(join(realDir, "references/guide.md"), "mine");
			await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
			await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
		});

		async function realFilesSurvive(): Promise<void> {
			expect(await readFile(join(realDir, "SKILL.md"), "utf-8")).toBe("mine");
			expect(
				await readFile(join(realDir, "references/guide.md"), "utf-8"),
			).toBe("mine");
		}

		it("unlinks a recorded folder that is a link to a real folder, leaving its files", async () => {
			const linkPath = join(projectDir, ".claude/skills/foo");
			await symlink(realDir, linkPath);

			const result = await nukeManifestFiles(projectDir, [
				".claude/skills/foo/",
			]);

			expect(result.removed).toEqual([".claude/skills/foo/"]);
			expect(await lstat(linkPath).catch(() => null)).toBeNull();
			await realFilesSurvive();
		});

		it("unlinks a recorded file that is a link, leaving its target", async () => {
			const linkPath = join(projectDir, ".claude/agents/x.md");
			await symlink(join(realDir, "SKILL.md"), linkPath);

			const result = await nukeManifestFiles(projectDir, [
				".claude/agents/x.md",
			]);

			expect(result.removed).toEqual([".claude/agents/x.md"]);
			expect(await lstat(linkPath).catch(() => null)).toBeNull();
			await realFilesSurvive();
		});

		it("unlinks a dangling link", async () => {
			const linkPath = join(projectDir, ".claude/skills/foo");
			await symlink(join(testDir, "gone"), linkPath);

			const result = await nukeManifestFiles(projectDir, [
				".claude/skills/foo/",
			]);

			expect(result.removed).toEqual([".claude/skills/foo/"]);
			expect(await lstat(linkPath).catch(() => null)).toBeNull();
		});

		it("removes a skill folder holding a link without touching the link's target", async () => {
			const skillDir = join(projectDir, ".claude/skills/foo");
			await mkdir(skillDir);
			await writeFile(join(skillDir, "SKILL.md"), "installed");
			await symlink(realDir, join(skillDir, "shared"));

			const result = await nukeManifestFiles(projectDir, [
				".claude/skills/foo/",
			]);

			expect(result.removed).toEqual([".claude/skills/foo/"]);
			expect(await fileExists(skillDir)).toBe(false);
			await realFilesSurvive();
		});

		it("leaves a path below a linked folder the manifest doesn't record untouched", async () => {
			const linkPath = join(projectDir, ".claude/agents/team");
			await symlink(realDir, linkPath);

			const result = await nukeManifestFiles(projectDir, [
				".claude/agents/team/SKILL.md",
			]);

			expect(result.removed).toEqual([]);
			expect(result.skipped).toEqual([".claude/agents/team/SKILL.md"]);
			expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
			await realFilesSurvive();
		});

		it("unlinks a recorded linked folder and leaves the recorded paths below it alone", async () => {
			const linkPath = join(projectDir, ".claude/skills/foo");
			await symlink(realDir, linkPath);

			const result = await nukeManifestFiles(projectDir, [
				".claude/skills/foo/references/guide.md",
				".claude/skills/foo/",
				".claude/skills/foo/SKILL.md",
			]);

			expect(result.removed).toEqual([".claude/skills/foo/"]);
			expect(await lstat(linkPath).catch(() => null)).toBeNull();
			await realFilesSurvive();
		});

		it("still removes through a linked shared .claude/skills root, as before", async () => {
			const sharedRoot = join(testDir, "shared-skills");
			await mkdir(join(sharedRoot, "foo"), { recursive: true });
			await writeFile(join(sharedRoot, "foo/SKILL.md"), "installed");
			await rm(join(projectDir, ".claude/skills"), { recursive: true });
			await symlink(sharedRoot, join(projectDir, ".claude/skills"));

			const result = await nukeManifestFiles(projectDir, [
				".claude/skills/foo/",
			]);

			expect(result.removed).toEqual([".claude/skills/foo/"]);
			expect(await fileExists(join(sharedRoot, "foo"))).toBe(false);
		});
	});
});
