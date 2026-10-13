import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";

let testDir: string;
let sourceDir: string;
let projectDir: string;

async function createSourceFile(...segments: string[]): Promise<void> {
	const filePath = join(sourceDir, ...segments);
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, `content of ${segments.join("/")}`);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("copyBareSkill", () => {
	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "agntc-copy-test-"));
		sourceDir = join(testDir, "source-skill");
		projectDir = join(testDir, "project");
		await mkdir(sourceDir, { recursive: true });
		await mkdir(projectDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("copies SKILL.md and references to target", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("references", "guide.md");

		const result = await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
		expect(await fileExists(join(destDir, "references", "guide.md"))).toBe(
			true,
		);
		expect(await readFile(join(destDir, "SKILL.md"), "utf-8")).toBe(
			"content of SKILL.md",
		);
		expect(result.copiedFiles).toEqual([".claude/skills/source-skill/"]);
	});

	it("excludes agntc.json", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("agntc.json");

		await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
		expect(await fileExists(join(destDir, "agntc.json"))).toBe(false);
	});

	it("preserves subdir structure", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("examples", "basic.ts");
		await createSourceFile("examples", "advanced.ts");

		await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "examples", "basic.ts"))).toBe(true);
		expect(await fileExists(join(destDir, "examples", "advanced.ts"))).toBe(
			true,
		);
	});

	it("returns correct relative paths with trailing slash", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("references", "guide.md");

		const result = await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const skillName = basename(sourceDir);
		const expectedDir = `.claude/skills/${skillName}/`;
		expect(result.copiedFiles).toContain(expectedDir);
	});

	it("creates the .claude/skills destination when missing", async () => {
		await createSourceFile("SKILL.md");

		await copyBareSkill({ sourceDir, projectDir });

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
	});

	it("handles empty skill dir (only agntc.json)", async () => {
		await createSourceFile("agntc.json");

		const result = await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const skillName = basename(sourceDir);
		const destDir = join(projectDir, ".claude/skills", skillName);
		expect(await fileExists(destDir)).toBe(true);
		expect(result.copiedFiles).toContain(`.claude/skills/${skillName}/`);
	});

	it("skillName matches source basename", async () => {
		const customSourceDir = join(testDir, "my-awesome-skill");
		await mkdir(customSourceDir, { recursive: true });
		await writeFile(join(customSourceDir, "SKILL.md"), "content");

		const result = await copyBareSkill({
			sourceDir: customSourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/my-awesome-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
		expect(result.copiedFiles).toContain(".claude/skills/my-awesome-skill/");
	});

	// Regression: a real git clone always contains a `.git` dir. For a whole-repo
	// bare skill the source dir IS the clone root, so an unfiltered recursive copy
	// drops the entire git repo into the installed skill. (Existing tests above use
	// plain dirs with no `.git`, so this gap shipped silently.)
	it("excludes a .git directory from the copy", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile(".git", "config");
		await createSourceFile(".git", "hooks", "pre-commit.sample");

		await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
		expect(await fileExists(join(destDir, ".git"))).toBe(false);
		expect(await fileExists(join(destDir, ".git", "config"))).toBe(false);
	});

	// Regression: a whole-repo bare skill's sourceDir is the random `mkdtemp` clone
	// dir, so without an explicit name the install would land under the temp-dir
	// name instead of the repo basename (and `.git` would tag along).
	it("installs under the provided skillName, not basename(sourceDir)", async () => {
		const cloneDir = join(testDir, "agntc-Xy12ab"); // mimic mkdtemp clone root
		await mkdir(join(cloneDir, ".git", "hooks"), { recursive: true });
		await writeFile(join(cloneDir, "SKILL.md"), "content");

		const result = await copyBareSkill({
			sourceDir: cloneDir,
			projectDir,
			skillName: "refero-design",
		});

		expect(
			await fileExists(
				join(projectDir, ".claude/skills/refero-design/SKILL.md"),
			),
		).toBe(true);
		expect(
			await fileExists(join(projectDir, ".claude/skills/refero-design/.git")),
		).toBe(false);
		expect(
			await fileExists(join(projectDir, ".claude/skills/agntc-Xy12ab")),
		).toBe(false);
		expect(result.copiedFiles).toEqual([".claude/skills/refero-design/"]);
	});

	it("handles deeply nested subdirs", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("a", "b", "c", "deep.md");

		await copyBareSkill({
			sourceDir,
			projectDir,
		});

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "a", "b", "c", "deep.md"))).toBe(
			true,
		);
		expect(
			await readFile(join(destDir, "a", "b", "c", "deep.md"), "utf-8"),
		).toBe("content of a/b/c/deep.md");
	});

	it.each([
		"..",
		".",
		"",
		"a/b",
		"../escape",
	])("refuses %j as a skill's folder name, writing nothing", async (skillName) => {
		await createSourceFile("SKILL.md");

		await expect(
			copyBareSkill({ sourceDir, projectDir, skillName }),
		).rejects.toThrow(`"${skillName}" can't be a skill's folder name`);

		expect(await readdir(projectDir)).toEqual([]);
	});

	describe("a symlink in the way", () => {
		let realDir: string;

		beforeEach(async () => {
			await createSourceFile("SKILL.md");
			realDir = join(testDir, "my-own-skill");
			await mkdir(realDir, { recursive: true });
			await writeFile(join(realDir, "SKILL.md"), "mine");
			await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
		});

		it("refuses to write through a link at the target, leaving the link and its target", async () => {
			const linkPath = join(projectDir, ".claude/skills/source-skill");
			await symlink(realDir, linkPath);

			await expect(copyBareSkill({ sourceDir, projectDir })).rejects.toThrow(
				".claude/skills/source-skill is a symlink — agntc won't write through it",
			);

			expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
			expect(await readdir(realDir)).toEqual(["SKILL.md"]);
			expect(await readFile(join(realDir, "SKILL.md"), "utf-8")).toBe("mine");
		});

		it("refuses to write into a folder holding a link", async () => {
			const destDir = join(projectDir, ".claude/skills/source-skill");
			await mkdir(destDir);
			await symlink(realDir, join(destDir, "shared"));

			await expect(copyBareSkill({ sourceDir, projectDir })).rejects.toThrow(
				".claude/skills/source-skill/shared is a symlink",
			);

			expect(await readdir(realDir)).toEqual(["SKILL.md"]);
		});
	});
});
