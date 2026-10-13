import { execFileSync } from "node:child_process";
import {
	access,
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { SymlinkEscapeError } from "../src/copy-safety.js";

let testDir: string;
let sourceDir: string;
let projectDir: string;

async function createSourceFile(...segments: string[]): Promise<void> {
	const filePath = join(sourceDir, ...segments);
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, `content of ${segments.join("/")}`);
}

async function tree(base: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(base, path)), { recursive: true });
		await writeFile(join(base, path), content);
	}
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
		vi.restoreAllMocks();
		await rm(testDir, { recursive: true, force: true });
	});

	it("copies SKILL.md and references to target", async () => {
		await createSourceFile("SKILL.md");
		await createSourceFile("references", "guide.md");

		const result = await copyBareSkill({
			sourceDir,
			cloneRoot: sourceDir,
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
			cloneRoot: sourceDir,
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
			cloneRoot: sourceDir,
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
			cloneRoot: sourceDir,
			projectDir,
		});

		const skillName = basename(sourceDir);
		const expectedDir = `.claude/skills/${skillName}/`;
		expect(result.copiedFiles).toContain(expectedDir);
	});

	it("creates the .claude/skills destination when missing", async () => {
		await createSourceFile("SKILL.md");

		await copyBareSkill({ sourceDir, cloneRoot: sourceDir, projectDir });

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
	});

	it("handles empty skill dir (only agntc.json)", async () => {
		await createSourceFile("agntc.json");

		const result = await copyBareSkill({
			sourceDir,
			cloneRoot: sourceDir,
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
			cloneRoot: customSourceDir,
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
			cloneRoot: sourceDir,
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
			cloneRoot: cloneDir,
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
			cloneRoot: sourceDir,
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
			copyBareSkill({ sourceDir, cloneRoot: sourceDir, projectDir, skillName }),
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

			await expect(
				copyBareSkill({ sourceDir, cloneRoot: sourceDir, projectDir }),
			).rejects.toThrow(
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

			await expect(
				copyBareSkill({ sourceDir, cloneRoot: sourceDir, projectDir }),
			).rejects.toThrow(".claude/skills/source-skill/shared is a symlink");

			expect(await readdir(realDir)).toEqual(["SKILL.md"]);
		});
	});

	describe("a symlink in the source", () => {
		const INSTALLED = ".claude/skills/foo";
		let clone: string;
		let skill: string;
		/** A folder outside the clone. */
		let outside: string;

		beforeEach(async () => {
			clone = join(testDir, "clone");
			skill = join(clone, "skills/foo");
			outside = join(testDir, "outside");
			await tree(clone, {
				"skills/foo/SKILL.md": "foo",
				"skills/foo/ref/a.md": "a",
				"shared/guide.md": "guide",
				"docs/notes.md": "notes",
			});
			await tree(outside, { "secret.md": "secret" });
		});

		/** Copies foo, then deletes the clone, so nothing installed can lean on it. */
		async function copyFooThenDeleteClone() {
			const result = await copyBareSkill({
				sourceDir: skill,
				cloneRoot: clone,
				projectDir,
			});
			await rm(clone, { recursive: true, force: true });
			return result;
		}

		function installed(path: string): string {
			return join(projectDir, INSTALLED, path);
		}

		async function isLink(path: string): Promise<boolean> {
			return (await lstat(installed(path))).isSymbolicLink();
		}

		async function expectRefusedWritingNothing(): Promise<void> {
			await expect(
				copyBareSkill({ sourceDir: skill, cloneRoot: clone, projectDir }),
			).rejects.toBeInstanceOf(SymlinkEscapeError);
			expect(await fileExists(join(projectDir, INSTALLED))).toBe(false);
		}

		it("keeps a link to a file in the skill a relative link, which reads once the source is gone", async () => {
			await symlink("ref/a.md", join(skill, "link.md"));

			await copyFooThenDeleteClone();

			expect(await readlink(installed("link.md"))).toBe("ref/a.md");
			expect(await readFile(installed("link.md"), "utf-8")).toBe("a");
		});

		it("makes an absolute link to a file in the skill relative", async () => {
			await symlink(join(skill, "ref/a.md"), join(skill, "ref/abs.md"));

			await copyFooThenDeleteClone();

			expect(await readlink(installed("ref/abs.md"))).toBe("a.md");
			expect(await readFile(installed("ref/abs.md"), "utf-8")).toBe("a");
		});

		it("installs a link to a folder elsewhere in the clone as that folder", async () => {
			await symlink("../../shared", join(skill, "shared"));

			const { copiedFiles } = await copyFooThenDeleteClone();

			expect(await isLink("shared")).toBe(false);
			expect(await readFile(installed("shared/guide.md"), "utf-8")).toBe(
				"guide",
			);
			expect(copiedFiles).toEqual([`${INSTALLED}/`]);
		});

		it("installs a link to a file elsewhere in the clone as that file", async () => {
			await symlink("../../docs/notes.md", join(skill, "notes.md"));

			await copyFooThenDeleteClone();

			expect(await isLink("notes.md")).toBe(false);
			expect(await readFile(installed("notes.md"), "utf-8")).toBe("notes");
		});

		it("keeps a link to its own folder, or the repo root above it, a relative link, never a copy", async () => {
			await symlink("../foo", join(skill, "self"));
			await symlink("../..", join(skill, "repo"));

			await copyFooThenDeleteClone();

			expect(await readlink(installed("self"))).toBe(".");
			expect(await readlink(installed("repo"))).toBe("../..");
			expect((await readdir(installed(""))).sort()).toEqual([
				"SKILL.md",
				"ref",
				"repo",
				"self",
			]);
		});

		it("climbs a link to the repo root as far as written, whatever folder agntc runs in", async () => {
			const deep = join(clone, "skills/a/b/foo");
			await tree(deep, { "SKILL.md": "" });
			await symlink("../../../..", join(deep, "repo"));
			vi.spyOn(process, "cwd").mockReturnValue("/");

			await copyBareSkill({ sourceDir: deep, cloneRoot: clone, projectDir });

			expect(await readlink(installed("repo"))).toBe("../../../..");
		});

		it("ends a cycle through folders elsewhere in the clone with a link back", async () => {
			await symlink("../../shared", join(skill, "shared"));
			await symlink("../docs", join(clone, "shared/docs"));
			await symlink("../shared", join(clone, "docs/back"));

			await copyFooThenDeleteClone();

			expect(await readFile(installed("shared/docs/notes.md"), "utf-8")).toBe(
				"notes",
			);
			expect(await readlink(installed("shared/docs/back"))).toBe("..");
			expect(
				await readFile(installed("shared/docs/back/guide.md"), "utf-8"),
			).toBe("guide");
		});

		it("copies what a link to a file the skill drops holds", async () => {
			await writeFile(join(skill, "agntc.json"), '{"type":"skill"}');
			await symlink("agntc.json", join(skill, "config.json"));

			await copyFooThenDeleteClone();

			expect(await isLink("config.json")).toBe(false);
			expect(await readFile(installed("config.json"), "utf-8")).toBe(
				'{"type":"skill"}',
			);
			expect(await fileExists(installed("agntc.json"))).toBe(false);
		});

		it("keeps a dangling link into the skill, and leaves out one to nothing elsewhere", async () => {
			await symlink("ref/gone.md", join(skill, "dangling"));
			await symlink("../../gone", join(skill, "nothing"));

			await copyFooThenDeleteClone();

			expect(await readlink(installed("dangling"))).toBe("ref/gone.md");
			expect(await lstat(installed("nothing")).catch(() => null)).toBeNull();
		});

		it("refuses a link out of the clone, writing nothing", async () => {
			await symlink(join(outside, "secret.md"), join(skill, "leak"));

			await expectRefusedWritingNothing();
		});

		it("refuses a link out of the clone inside a folder a link leads to", async () => {
			await symlink("../../shared", join(skill, "shared"));
			await symlink(outside, join(clone, "shared/leak"));

			await expectRefusedWritingNothing();
		});

		it("refuses a link that leads out of the clone through another link", async () => {
			await symlink(outside, join(clone, "hop"));
			await symlink("../../hop/secret.md", join(skill, "leak"));

			await expectRefusedWritingNothing();
		});

		it("keeps file modes, so a script stays executable, linked or not", async () => {
			await tree(clone, {
				"skills/foo/run.sh": "#!/bin/sh",
				"scripts/tool.sh": "#!/bin/sh",
			});
			await chmod(join(skill, "run.sh"), 0o755);
			await chmod(join(clone, "scripts/tool.sh"), 0o755);
			await symlink("../../scripts/tool.sh", join(skill, "tool.sh"));

			await copyFooThenDeleteClone();

			expect((await stat(installed("run.sh"))).mode & 0o777).toBe(0o755);
			expect((await stat(installed("tool.sh"))).mode & 0o777).toBe(0o755);
		});

		it("keeps hidden files, dropping only .git", async () => {
			await tree(clone, {
				"skills/foo/.env.example": "",
				"skills/foo/.config/settings.json": "",
			});

			await copyFooThenDeleteClone();

			expect(await fileExists(installed(".env.example"))).toBe(true);
			expect(await fileExists(installed(".config/settings.json"))).toBe(true);
		});

		it("skips a FIFO, and a link to one, without blocking", async () => {
			execFileSync("mkfifo", [join(skill, "pipe")]);
			execFileSync("mkfifo", [join(clone, "docs/pipe")]);
			await symlink("../../docs/pipe", join(skill, "linked-pipe"));

			await copyFooThenDeleteClone();

			expect((await readdir(installed(""))).sort()).toEqual([
				"SKILL.md",
				"ref",
			]);
		});
	});
});
