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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { checkItemLinks } from "../src/copy-item.js";
import { type CopySource, SymlinkEscapeError } from "../src/copy-safety.js";

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

/** Links each path below `base` to its target, written as given. */
async function link(base: string, links: Record<string, string>) {
	for (const [path, target] of Object.entries(links)) {
		await mkdir(dirname(join(base, path)), { recursive: true });
		await symlink(target, join(base, path));
	}
}

function remote(root: string): CopySource {
	return { root, local: false };
}

function local(root: string): CopySource {
	return { root, local: true };
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
			source: remote(sourceDir),
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
			source: remote(sourceDir),
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
			source: remote(sourceDir),
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
			source: remote(sourceDir),
			projectDir,
		});

		const skillName = basename(sourceDir);
		const expectedDir = `.claude/skills/${skillName}/`;
		expect(result.copiedFiles).toContain(expectedDir);
	});

	it("creates the .claude/skills destination when missing", async () => {
		await createSourceFile("SKILL.md");

		await copyBareSkill({ sourceDir, source: remote(sourceDir), projectDir });

		const destDir = join(projectDir, ".claude/skills/source-skill");
		expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
	});

	it("handles empty skill dir (only agntc.json)", async () => {
		await createSourceFile("agntc.json");

		const result = await copyBareSkill({
			sourceDir,
			source: remote(sourceDir),
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
			source: remote(customSourceDir),
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
			source: remote(sourceDir),
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
			source: remote(cloneDir),
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
			source: remote(sourceDir),
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
			copyBareSkill({
				sourceDir,
				source: remote(sourceDir),
				projectDir,
				skillName,
			}),
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
				copyBareSkill({ sourceDir, source: remote(sourceDir), projectDir }),
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
				copyBareSkill({ sourceDir, source: remote(sourceDir), projectDir }),
			).rejects.toThrow(".claude/skills/source-skill/shared is a symlink");

			expect(await readdir(realDir)).toEqual(["SKILL.md"]);
		});
	});

	describe("a symlink in the source", () => {
		const INSTALLED = ".claude/skills/foo";
		let clone: string;
		let skill: string;

		beforeEach(async () => {
			clone = join(testDir, "clone");
			skill = join(clone, "skills/foo");
			await tree(clone, {
				"skills/foo/SKILL.md": "foo",
				"skills/foo/ref/a.md": "a",
				"shared/guide.md": "guide",
			});
		});

		function copyFoo(source: CopySource) {
			return copyBareSkill({ sourceDir: skill, source, projectDir });
		}

		/** The symlink-escape pre-flight `add` and `update` run on foo. */
		function preflightFoo(source: CopySource) {
			return checkItemLinks(
				{ kind: "skill", skill: { name: "foo", path: "skills/foo" } },
				source,
			);
		}

		/** Copies foo from a clone, then deletes the clone, as add and update do. */
		async function copyFromCloneThenDelete(): Promise<void> {
			await copyFoo(remote(clone));
			await rm(clone, { recursive: true, force: true });
		}

		function installed(path: string): string {
			return join(projectDir, INSTALLED, path);
		}

		async function installedNames(path = ""): Promise<string[]> {
			return (await readdir(installed(path))).sort();
		}

		/** A link to its own folder, and two to folders above it. */
		async function linkToTheSkillAndAbove(): Promise<void> {
			await symlink("../foo", join(skill, "self"));
			await symlink("..", join(skill, "ref/up"));
			await symlink("../..", join(skill, "repo"));
		}

		/** A link to a folder and one to a file elsewhere in the clone. */
		async function linkElsewhere(): Promise<void> {
			await symlink("../../shared", join(skill, "shared"));
			await symlink("../../shared/guide.md", join(skill, "guide.md"));
		}

		async function isRealFolder(path: string): Promise<boolean> {
			return (await lstat(installed(path))).isDirectory();
		}

		async function isRealFile(path: string): Promise<boolean> {
			return (await lstat(installed(path))).isFile();
		}

		it("keeps a link to a file in the skill a relative link, which reads once the clone is gone", async () => {
			await symlink("ref/a.md", join(skill, "link.md"));

			await copyFromCloneThenDelete();

			expect(await readlink(installed("link.md"))).toBe("ref/a.md");
			expect(await readFile(installed("link.md"), "utf-8")).toBe("a");
		});

		it("makes an absolute link to a file in the skill relative", async () => {
			await symlink(join(skill, "ref/a.md"), join(skill, "ref/abs.md"));

			await copyFromCloneThenDelete();

			expect(await readlink(installed("ref/abs.md"))).toBe("a.md");
			expect(await readFile(installed("ref/abs.md"), "utf-8")).toBe("a");
		});

		it("leaves out of a clone's skill a link to its own folder or above it", async () => {
			await linkToTheSkillAndAbove();

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
			expect(await installedNames("ref")).toEqual(["a.md"]);
		});

		it("copies a file a clone's skill links to elsewhere in the clone in the link's place", async () => {
			await symlink("../../shared/guide.md", join(skill, "guide.md"));

			await copyFromCloneThenDelete();

			expect(await isRealFile("guide.md")).toBe(true);
			expect(await readFile(installed("guide.md"), "utf-8")).toBe("guide");
		});

		it("copies a folder a clone's skill links to elsewhere in the clone in the link's place", async () => {
			await tree(clone, { "shared/deep/more.md": "more" });
			await symlink("../../../shared", join(skill, "ref/shared"));

			await copyFromCloneThenDelete();

			expect(await isRealFolder("ref/shared")).toBe(true);
			expect(await installedNames("ref/shared")).toEqual(["deep", "guide.md"]);
			expect(await readFile(installed("ref/shared/guide.md"), "utf-8")).toBe(
				"guide",
			);
			expect(
				await readFile(installed("ref/shared/deep/more.md"), "utf-8"),
			).toBe("more");
		});

		it("judges the links in a folder it copies in a link's place against that folder, and copies none in its turn", async () => {
			await tree(clone, { "other/x.md": "x" });
			await link(clone, {
				"shared/alias.md": "guide.md",
				"shared/self": ".",
				"shared/up": "..",
				"shared/back": "../skills/foo/ref",
				"shared/other": "../other",
				"shared/x.md": "../other/x.md",
			});
			await symlink("../../shared", join(skill, "shared"));

			await copyFromCloneThenDelete();

			expect(await installedNames("shared")).toEqual(["alias.md", "guide.md"]);
			expect(await readlink(installed("shared/alias.md"))).toBe("guide.md");
			expect(await readFile(installed("shared/alias.md"), "utf-8")).toBe(
				"guide",
			);
		});

		it("copies each of two folders linking to each other once, through the skill's links to both", async () => {
			await tree(clone, { "a/a.md": "a", "b/b.md": "b" });
			await link(clone, { "a/to-b": "../b", "b/to-a": "../a" });
			await link(skill, { a: "../../a", b: "../../b" });

			await copyFromCloneThenDelete();

			expect(await installedNames("a")).toEqual(["a.md"]);
			expect(await installedNames("b")).toEqual(["b.md"]);
		});

		it.each([
			["a link", { "skills/foo/chain": "../../alias", alias: "shared" }],
			[
				"a link to a file",
				{
					"skills/foo/chain.md": "../../alias.md",
					"alias.md": "shared/guide.md",
				},
			],
			[
				"below a linked folder",
				{ "skills/foo/below": "../../linked/guide.md", linked: "shared" },
			],
			["missing", { "skills/foo/gone": "../../gone/guide.md" }],
			["below a file", { "skills/foo/under": "../../shared/guide.md/x" }],
		])("leaves out a link elsewhere in a clone to %s", async (_what, links) => {
			await link(clone, links);

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		// Root reads any folder, mode or not.
		it.skipIf(process.getuid?.() === 0).each([
			["a file", "guide.md"],
			["a folder", "deep"],
		])(
			"leaves out a link to %s in a folder it can't list, passing the pre-flight and installing the rest",
			async (_kind, name) => {
				const locked = join(clone, "shared");
				await tree(clone, { "shared/deep/more.md": "" });
				await symlink(`../../shared/${name}`, join(skill, "linked"));
				await chmod(locked, 0o311);
				try {
					const check = await preflightFoo(remote(clone));
					await copyFoo(remote(clone));

					expect(check).toEqual({ ok: true });
				} finally {
					await chmod(locked, 0o755);
				}
				expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
			},
		);

		it("leaves out a link elsewhere in a clone to a FIFO without blocking", async () => {
			execFileSync("mkfifo", [join(clone, "pipe")]);
			await symlink("../../pipe", join(skill, "pipe"));

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("never copies a .git in a link's place, whether the link leads to one, into one, or to a folder holding one", async () => {
			await tree(clone, {
				".git/HEAD": "ref",
				"vendor/lib/.git/config": "",
				"shared/.git/HEAD": "ref",
			});
			await link(skill, {
				history: "../../.git",
				"head.txt": "../../.git/HEAD",
				config: "../../vendor/lib/.git/config",
				shared: "../../shared",
			});

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref", "shared"]);
			expect(await installedNames("shared")).toEqual(["guide.md"]);
		});

		it.each([
			".GIT",
			".Git",
		])("never copies a .git in a link's place through a link spelling it %s, to the clone's or one spelled so", async (spelling) => {
			await tree(clone, {
				".git/config": "url = https://token@host/repo",
				[`vendor/${spelling}/config`]: "",
			});
			await link(skill, {
				config: `../../${spelling}/config`,
				history: `../../${spelling}`,
				vendored: `../../vendor/${spelling}`,
			});

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("leaves out a link naming its target in another case than the folder lists it, so it never reads the folder above the skill", async () => {
			await link(skill, {
				skills: "../../SKILLS",
				"guide.md": "../../SHARED/guide.md",
			});

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("leaves out a link into a folder the skill drops, though what it names lies below it", async () => {
			await tree(skill, { "agntc.json/data": "data" });
			await symlink("agntc.json/data", join(skill, "data"));

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("drops agntc.json only at the skill's top, from what it copies in a link's place too", async () => {
			await tree(clone, {
				"shared/agntc.json": "{}",
				"config/agntc.json": "{}",
			});
			await link(clone, { "shared/config.json": "agntc.json" });
			await link(skill, {
				shared: "../../shared",
				"agntc.json": "../../config/agntc.json",
			});

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref", "shared"]);
			expect(await installedNames("shared")).toEqual([
				"agntc.json",
				"config.json",
				"guide.md",
			]);
			expect(await readlink(installed("shared/config.json"))).toBe(
				"agntc.json",
			);
		});

		describe("a link to a folder elsewhere holding a link out of the source", () => {
			const SECRET = () => join(testDir, "outside/secret.md");

			beforeEach(async () => {
				await tree(testDir, { "outside/secret.md": "secret" });
				await symlink(SECRET(), join(clone, "shared/leak"));
				await symlink("../../shared", join(skill, "shared"));
			});

			it("is refused from a clone, by the pre-flight and by the copy, writing nothing", async () => {
				const refusal = new SymlinkEscapeError("shared/leak", SECRET());

				const check = await preflightFoo(remote(clone));

				expect(check).toEqual({ ok: false, message: refusal.message });
				await expect(copyFoo(remote(clone))).rejects.toThrow(refusal);
				expect(await fileExists(join(projectDir, INSTALLED))).toBe(false);
			});

			it("passes the pre-flight from a local source and installs as an absolute link", async () => {
				const check = await preflightFoo(local(clone));

				await copyFoo(local(clone));

				expect(check).toEqual({ ok: true });
				expect(await readlink(installed("shared"))).toBe(join(clone, "shared"));
			});
		});

		it("passes the pre-flight on a link out of the clone that the skill filter drops, as the copy never reads it", async () => {
			await tree(testDir, { "outside/secret.md": "secret" });
			await symlink(join(testDir, "outside"), join(clone, "shared/leak"));
			await link(skill, {
				".git": "../../shared",
				"agntc.json": join(testDir, "outside/secret.md"),
			});

			const check = await preflightFoo(remote(clone));
			await copyFromCloneThenDelete();

			expect(check).toEqual({ ok: true });
			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("links a local skill's link to its own folder, above it or elsewhere in the source absolutely into the source", async () => {
			await linkToTheSkillAndAbove();
			await linkElsewhere();

			await copyFoo(local(clone));

			expect(await readlink(installed("self"))).toBe(skill);
			expect(await readlink(installed("ref/up"))).toBe(skill);
			expect(await readlink(installed("repo"))).toBe(clone);
			expect(await readlink(installed("shared"))).toBe(join(clone, "shared"));
			expect(await readFile(installed("guide.md"), "utf-8")).toBe("guide");
		});

		it.each([
			["a clone", remote],
			["a local source", local],
		])("leaves out a link to what the skill drops, from %s", async (_kind, kind) => {
			await tree(skill, { ".git/HEAD": "ref", "agntc.json": "{}" });
			await symlink(".git", join(skill, "history"));
			await symlink(".git/HEAD", join(skill, "head"));
			await symlink("agntc.json", join(skill, "config.json"));

			await copyFoo(kind(clone));

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});

		it("finishes at once through chains of links, inside the skill and out of it", async () => {
			for (let i = 0; i < 16; i += 1) {
				await mkdir(join(skill, `c${i}`));
				await mkdir(join(clone, `d${i}`));
				for (const name of ["x", "y"]) {
					await symlink(`../c${i + 1}`, join(skill, `c${i}`, name));
					await symlink(`../d${i + 1}`, join(clone, `d${i}`, name));
				}
			}
			await symlink("../../d0", join(skill, "chain"));

			await copyFromCloneThenDelete();

			expect(await readlink(installed("c0/x"))).toBe("../c1");
			expect(await readlink(installed("c15/y"))).toBe("../c16");
			expect(await isRealFolder("chain")).toBe(true);
			expect(await installedNames("chain")).toEqual([]);
		});

		it("keeps a dangling link into the skill, and leaves out a dangling one elsewhere in a clone", async () => {
			await symlink("ref/gone.md", join(skill, "dangling"));
			await symlink("../../gone", join(skill, "nothing"));

			await copyFromCloneThenDelete();

			expect(await readlink(installed("dangling"))).toBe("ref/gone.md");
			expect(await installedNames()).not.toContain("nothing");
		});

		it.each([
			["a clone", remote],
			["a local source", local],
		])("refuses a link out of %s, writing nothing", async (_kind, kind) => {
			await tree(testDir, { "outside/secret.md": "secret" });
			await symlink(join(testDir, "outside/secret.md"), join(skill, "leak"));

			await expect(copyFoo(kind(clone))).rejects.toBeInstanceOf(
				SymlinkEscapeError,
			);
			expect(await fileExists(join(projectDir, INSTALLED))).toBe(false);
		});

		it("keeps file modes, so a script stays executable", async () => {
			await tree(skill, { "run.sh": "#!/bin/sh" });
			await chmod(join(skill, "run.sh"), 0o755);

			await copyFromCloneThenDelete();

			expect((await stat(installed("run.sh"))).mode & 0o777).toBe(0o755);
		});

		it("keeps hidden files, dropping only .git", async () => {
			await tree(skill, { ".env.example": "", ".config/settings.json": "" });

			await copyFromCloneThenDelete();

			expect(await fileExists(installed(".env.example"))).toBe(true);
			expect(await fileExists(installed(".config/settings.json"))).toBe(true);
		});

		it("drops a .git spelled in any case from the skill's own content, keeping .github", async () => {
			await tree(skill, {
				".GIT/config": "",
				"ref/.Git/HEAD": "",
				".github/workflows/ci.yml": "",
			});

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual([".github", "SKILL.md", "ref"]);
			expect(await installedNames("ref")).toEqual(["a.md"]);
			expect(await fileExists(installed(".github/workflows/ci.yml"))).toBe(
				true,
			);
		});

		it("skips a FIFO without blocking", async () => {
			execFileSync("mkfifo", [join(skill, "pipe")]);

			await copyFromCloneThenDelete();

			expect(await installedNames()).toEqual(["SKILL.md", "ref"]);
		});
	});
});
