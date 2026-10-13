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
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeIncomingFiles } from "../src/compute-incoming-files.js";
import { copyPack, listAgentFiles } from "../src/copy-pack.js";
import {
	type CopySource,
	checkEscapingSymlinks,
	SymlinkEscapeError,
} from "../src/copy-safety.js";
import type { FoundPack } from "../src/discover.js";

let base: string;
let root: string;
let projectDir: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), "agntc-copy-pack-"));
	root = join(base, "source");
	projectDir = join(base, "project");
	await mkdir(root, { recursive: true });
	await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(base, { recursive: true, force: true });
});

async function tree(spec: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(spec)) {
		const full = join(root, path);
		if (path.endsWith("/")) {
			await mkdir(full, { recursive: true });
			continue;
		}
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

async function installed(path: string): Promise<boolean> {
	return access(join(projectDir, path)).then(
		() => true,
		() => false,
	);
}

function remote(root: string): CopySource {
	return { root, local: false };
}

function local(root: string): CopySource {
	return { root, local: true };
}

function pack(overrides: Partial<FoundPack> = {}): FoundPack {
	return {
		name: "laravel",
		path: "laravel",
		skills: [],
		assetDirs: [],
		...overrides,
	};
}

describe("copyPack", () => {
	it("copies each skill flat into .claude/skills by folder name", async () => {
		await tree({
			"laravel/skills/api/SKILL.md": "",
			"laravel/skills/api/refs/guide.md": "",
			"laravel/group/deep/models/SKILL.md": "",
		});

		const result = await copyPack(
			pack({
				skills: [
					{ name: "models", path: "laravel/group/deep/models" },
					{ name: "api", path: "laravel/skills/api" },
				],
			}),
			remote(root),
			projectDir,
		);

		expect(result.copiedFiles).toEqual([
			".claude/skills/models/",
			".claude/skills/api/",
		]);
		expect(await installed(".claude/skills/models/SKILL.md")).toBe(true);
		expect(await installed(".claude/skills/api/refs/guide.md")).toBe(true);
	});

	it("strips agntc.json from each copied skill", async () => {
		await tree({
			"laravel/skills/api/SKILL.md": "",
			"laravel/skills/api/agntc.json": "{}",
		});

		await copyPack(
			pack({ skills: [{ name: "api", path: "laravel/skills/api" }] }),
			remote(root),
			projectDir,
		);

		expect(await installed(".claude/skills/api/agntc.json")).toBe(false);
	});

	it("copies only .md files from agents/, keeping their relative paths", async () => {
		await tree({
			"laravel/agents/reviewer.md": "",
			"laravel/agents/nested/planner.md": "",
			"laravel/agents/openai.yaml": "",
			"laravel/agents/nested/config.json": "",
		});

		const result = await copyPack(
			pack({ assetDirs: ["agents"] }),
			remote(root),
			projectDir,
		);

		expect(result.copiedFiles).toEqual([
			".claude/agents/nested/planner.md",
			".claude/agents/reviewer.md",
		]);
		expect(await installed(".claude/agents/openai.yaml")).toBe(false);
		expect(await installed(".claude/agents/nested/config.json")).toBe(false);
		expect(result.assetCounts.agents).toBe(2);
	});

	it("skips hidden files and hidden folders in agents/", async () => {
		await tree({
			"laravel/agents/reviewer.md": "",
			"laravel/agents/.draft.md": "",
			"laravel/agents/.private/secret.md": "",
		});

		const result = await copyPack(
			pack({ assetDirs: ["agents"] }),
			remote(root),
			projectDir,
		);

		expect(result.copiedFiles).toEqual([".claude/agents/reviewer.md"]);
		expect(await installed(".claude/agents/.draft.md")).toBe(false);
		expect(await installed(".claude/agents/.private")).toBe(false);
	});

	it("copies hooks/ entries whole, recording a folder and its contents", async () => {
		await tree({
			"laravel/hooks/pre.sh": "",
			"laravel/hooks/lint/run.sh": "",
		});

		const result = await copyPack(
			pack({ assetDirs: ["hooks"] }),
			remote(root),
			projectDir,
		);

		expect([...result.copiedFiles].sort()).toEqual([
			".claude/hooks/lint/",
			".claude/hooks/lint/run.sh",
			".claude/hooks/pre.sh",
		]);
		expect(result.assetCounts.hooks).toBe(2);
		expect(await installed(".claude/hooks/lint/run.sh")).toBe(true);
	});

	it("skips hidden entries at every depth of hooks/", async () => {
		await tree({
			"laravel/hooks/pre.sh": "",
			"laravel/hooks/.DS_Store": "",
			"laravel/hooks/.cache/run.sh": "",
			"laravel/hooks/lint/run.sh": "",
			"laravel/hooks/lint/.DS_Store": "",
			"laravel/hooks/lint/.git/HEAD": "",
			"laravel/hooks/lint/deep/.env": "",
			"laravel/hooks/lint/deep/check.sh": "",
		});

		const result = await copyPack(
			pack({ assetDirs: ["hooks"] }),
			remote(root),
			projectDir,
		);

		expect([...result.copiedFiles].sort()).toEqual([
			".claude/hooks/lint/",
			".claude/hooks/lint/deep/",
			".claude/hooks/lint/deep/check.sh",
			".claude/hooks/lint/run.sh",
			".claude/hooks/pre.sh",
		]);
		expect(result.assetCounts.hooks).toBe(2);
		for (const hidden of [
			".claude/hooks/.DS_Store",
			".claude/hooks/.cache",
			".claude/hooks/lint/.DS_Store",
			".claude/hooks/lint/.git",
			".claude/hooks/lint/deep/.env",
		]) {
			expect(await installed(hidden)).toBe(false);
		}
		expect(await installed(".claude/hooks/lint/deep/check.sh")).toBe(true);
	});

	it("leaves agents/ and hooks/ alone when the pack doesn't list them", async () => {
		await tree({
			"laravel/agents/notes.txt": "",
			"laravel/hooks/pre.sh": "",
		});

		const result = await copyPack(pack(), remote(root), projectDir);

		expect(result.copiedFiles).toEqual([]);
		expect(await installed(".claude/hooks/pre.sh")).toBe(false);
	});

	it("reads a pack at the root from the root", async () => {
		await tree({ "skills/a/SKILL.md": "", "agents/a.md": "" });

		const result = await copyPack(
			pack({
				name: "repo",
				path: "",
				skills: [{ name: "a", path: "skills/a" }],
				assetDirs: ["agents"],
			}),
			remote(root),
			projectDir,
		);

		expect(result.copiedFiles).toEqual([
			".claude/skills/a/",
			".claude/agents/a.md",
		]);
	});

	it("counts its skills, agents and hooks", async () => {
		await tree({
			"laravel/skills/a/SKILL.md": "",
			"laravel/skills/b/SKILL.md": "",
			"laravel/agents/x.md": "",
			"laravel/hooks/h.sh": "",
		});

		const result = await copyPack(
			pack({
				skills: [
					{ name: "a", path: "laravel/skills/a" },
					{ name: "b", path: "laravel/skills/b" },
				],
				assetDirs: ["agents", "hooks"],
			}),
			remote(root),
			projectDir,
		);

		expect(result.assetCounts).toEqual({ skills: 2, agents: 1, hooks: 1 });
	});

	it("rolls back everything it copied when a later copy fails", async () => {
		await tree({
			"laravel/skills/a/SKILL.md": "",
			"laravel/agents/x.md": "",
		});

		await expect(
			copyPack(
				pack({
					skills: [
						{ name: "a", path: "laravel/skills/a" },
						{ name: "missing", path: "laravel/skills/missing" },
					],
					assetDirs: ["agents"],
				}),
				remote(root),
				projectDir,
			),
		).rejects.toThrow();

		expect(await installed(".claude/skills/a")).toBe(false);
		expect(await installed(".claude/skills/missing")).toBe(false);
		expect(await installed(".claude/agents/x.md")).toBe(false);
	});

	describe("a symlink in the way", () => {
		let realDir: string;

		beforeEach(async () => {
			await tree({
				"laravel/skills/a/SKILL.md": "",
				"laravel/agents/team/lead.md": "",
				"laravel/hooks/lint/run.sh": "",
			});
			realDir = join(base, "my-own");
			await mkdir(realDir, { recursive: true });
			await writeFile(join(realDir, "keep.md"), "mine");
		});

		async function linkAt(relPath: string): Promise<void> {
			const linkPath = join(projectDir, relPath);
			await mkdir(dirname(linkPath), { recursive: true });
			await symlink(realDir, linkPath);
		}

		const PACK_WITH_ASSETS = pack({
			skills: [{ name: "a", path: "laravel/skills/a" }],
			assetDirs: ["agents", "hooks"],
		});

		it("refuses an agent below a linked folder, writing nothing into it and rolling back", async () => {
			await linkAt(".claude/agents/team");

			await expect(
				copyPack(PACK_WITH_ASSETS, remote(root), projectDir),
			).rejects.toThrow(
				".claude/agents/team is a symlink — agntc won't write through it",
			);

			expect(await readdir(realDir)).toEqual(["keep.md"]);
			expect(await installed(".claude/skills/a")).toBe(false);
			expect(
				(await lstat(join(projectDir, ".claude/agents/team"))).isSymbolicLink(),
			).toBe(true);
		});

		it("refuses a hook entry that is a link, writing nothing into it", async () => {
			await linkAt(".claude/hooks/lint");

			await expect(
				copyPack(PACK_WITH_ASSETS, remote(root), projectDir),
			).rejects.toThrow(".claude/hooks/lint is a symlink");

			expect(await readdir(realDir)).toEqual(["keep.md"]);
			expect(await installed(".claude/agents/team/lead.md")).toBe(false);
		});
	});

	describe("a symlink in the pack's hooks/ or agents/", () => {
		const HOOKS = pack({ assetDirs: ["hooks"] });

		/** Copies the pack from a clone, then deletes it, as add and update do. */
		async function copyFromCloneThenDelete(found: FoundPack = HOOKS) {
			const result = await copyPack(found, remote(root), projectDir);
			await rm(root, { recursive: true, force: true });
			return result;
		}

		function hookClaims(): Promise<string[]> {
			return computeIncomingFiles({ kind: "pack", pack: HOOKS }, root);
		}

		function sorted(paths: string[]): string[] {
			return [...paths].sort();
		}

		it.each([
			["a clone", remote],
			["a local source", local],
		])("never installs or claims a link at the top of hooks/, from %s", async (_kind, kind) => {
			await tree({
				"laravel/hooks/pre.sh": "",
				"scripts/fmt.sh": "",
				"tools/lint/run.sh": "",
			});
			await symlink("../../scripts/fmt.sh", join(root, "laravel/hooks/fmt.sh"));
			await symlink("../../tools/lint", join(root, "laravel/hooks/lint"));
			await symlink("pre.sh", join(root, "laravel/hooks/alias.sh"));

			const result = await copyPack(HOOKS, kind(root), projectDir);

			expect(result.copiedFiles).toEqual([".claude/hooks/pre.sh"]);
			expect(result.assetCounts.hooks).toBe(1);
			expect(await hookClaims()).toEqual(result.copiedFiles);
		});

		it("never installs or claims a FIFO, at the top of hooks/ or in a hook folder", async () => {
			await tree({
				"laravel/hooks/pre.sh": "",
				"laravel/hooks/lint/run.sh": "",
			});
			execFileSync("mkfifo", [join(root, "laravel/hooks/pipe")]);
			execFileSync("mkfifo", [join(root, "laravel/hooks/lint/pipe")]);
			const claims = await hookClaims();

			const result = await copyFromCloneThenDelete();

			expect(sorted(claims)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/pre.sh",
			]);
			expect(sorted(result.copiedFiles)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/lint/run.sh",
				".claude/hooks/pre.sh",
			]);
		});

		it("keeps a link in a hook folder to a file in it relative, and copies a file a clone's link out of it leads to in its place", async () => {
			await tree({
				"laravel/hooks/lint/run.sh": "run",
				"laravel/hooks/pre.sh": "pre",
				"scripts/env.sh": "env",
			});
			await symlink("run.sh", join(root, "laravel/hooks/lint/alias.sh"));
			await symlink("../pre.sh", join(root, "laravel/hooks/lint/pre.sh"));
			await symlink(
				"../../../scripts/env.sh",
				join(root, "laravel/hooks/lint/env.sh"),
			);

			const result = await copyFromCloneThenDelete();

			expect(sorted(result.copiedFiles)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/lint/alias.sh",
				".claude/hooks/lint/env.sh",
				".claude/hooks/lint/pre.sh",
				".claude/hooks/lint/run.sh",
				".claude/hooks/pre.sh",
			]);
			expect(
				await readlink(join(projectDir, ".claude/hooks/lint/alias.sh")),
			).toBe("run.sh");
			for (const [hook, text] of Object.entries({
				"lint/pre.sh": "pre",
				"lint/env.sh": "env",
			})) {
				const path = join(projectDir, ".claude/hooks", hook);
				expect((await lstat(path)).isFile()).toBe(true);
				expect(await readFile(path, "utf-8")).toBe(text);
			}
		});

		it("copies a folder a clone's hook folder links to in the link's place, filtered as a hook folder, recording and claiming all of it", async () => {
			await tree({
				"laravel/hooks/lint/run.sh": "",
				"scripts/lib/util.sh": "util",
				"scripts/lib/.cache/state": "",
				"scripts/lib/deep/more.sh": "",
				"scripts/.hidden/x.sh": "",
			});
			await symlink(
				"../../../scripts/lib",
				join(root, "laravel/hooks/lint/lib"),
			);
			await symlink("util.sh", join(root, "scripts/lib/alias.sh"));
			await symlink("../.hidden", join(root, "scripts/lib/hidden"));
			await symlink(
				"../../../scripts/.hidden/x.sh",
				join(root, "laravel/hooks/lint/.x.sh"),
			);
			const claims = await hookClaims();

			const result = await copyFromCloneThenDelete();

			expect(sorted(result.copiedFiles)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/lint/lib/",
				".claude/hooks/lint/lib/alias.sh",
				".claude/hooks/lint/lib/deep/",
				".claude/hooks/lint/lib/deep/more.sh",
				".claude/hooks/lint/lib/util.sh",
				".claude/hooks/lint/run.sh",
			]);
			expect(claims).toEqual([".claude/hooks/lint/"]);
			expect(
				(await lstat(join(projectDir, ".claude/hooks/lint/lib"))).isDirectory(),
			).toBe(true);
			expect(
				await readlink(join(projectDir, ".claude/hooks/lint/lib/alias.sh")),
			).toBe("util.sh");
		});

		it("links a local hook folder's link out of it absolutely into the source", async () => {
			await tree({ "laravel/hooks/lint/run.sh": "", "scripts/env.sh": "" });
			await symlink(
				"../../../scripts/env.sh",
				join(root, "laravel/hooks/lint/env.sh"),
			);

			const result = await copyPack(HOOKS, local(root), projectDir);

			expect(result.copiedFiles).toContain(".claude/hooks/lint/env.sh");
			expect(
				await readlink(join(projectDir, ".claude/hooks/lint/env.sh")),
			).toBe(join(root, "scripts/env.sh"));
		});

		it("leaves out a link to a hidden file in a hook folder", async () => {
			await tree({
				"laravel/hooks/lint/run.sh": "",
				"laravel/hooks/lint/.secrets/env": "TOKEN",
			});
			await symlink(".secrets/env", join(root, "laravel/hooks/lint/env"));

			const result = await copyFromCloneThenDelete();

			expect(sorted(result.copiedFiles)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/lint/run.sh",
			]);
		});

		it("agrees with the pre-flight on links to a folder above a hook: both pass, and nothing above is copied", async () => {
			await tree({ "laravel/hooks/lint/run.sh": "" });
			await symlink("../../..", join(root, "laravel/hooks/lint/up"));
			await symlink("../..", join(root, "laravel/hooks/up"));

			const check = await checkEscapingSymlinks(
				join(root, "laravel"),
				remote(root),
			);
			const result = await copyFromCloneThenDelete();

			expect(check).toEqual({ ok: true });
			expect(sorted(result.copiedFiles)).toEqual([
				".claude/hooks/lint/",
				".claude/hooks/lint/run.sh",
			]);
		});

		it("agrees with the pre-flight on a link out of the clone in a hook folder: both refuse, and the pack rolls back", async () => {
			await tree({
				"laravel/skills/a/SKILL.md": "",
				"laravel/hooks/lint/run.sh": "",
			});
			await symlink("../../../..", join(root, "laravel/hooks/lint/leak"));

			const check = await checkEscapingSymlinks(
				join(root, "laravel"),
				remote(root),
			);
			const copy = copyPack(
				pack({
					skills: [{ name: "a", path: "laravel/skills/a" }],
					assetDirs: ["hooks"],
				}),
				remote(root),
				projectDir,
			);

			expect(check.ok).toBe(false);
			await expect(copy).rejects.toBeInstanceOf(SymlinkEscapeError);
			expect(await installed(".claude/skills/a")).toBe(false);
			expect(await installed(".claude/hooks/lint")).toBe(false);
		});

		it("agrees with the pre-flight on a link out of the clone in a folder a hook folder links to: both refuse, and the pack rolls back", async () => {
			await tree({
				"laravel/skills/a/SKILL.md": "",
				"laravel/hooks/lint/run.sh": "",
				"scripts/lib/util.sh": "",
			});
			await symlink(
				"../../../scripts/lib",
				join(root, "laravel/hooks/lint/lib"),
			);
			await symlink("../../..", join(root, "scripts/lib/leak"));

			const check = await checkEscapingSymlinks(
				join(root, "laravel"),
				remote(root),
			);
			const copy = copyPack(
				pack({
					skills: [{ name: "a", path: "laravel/skills/a" }],
					assetDirs: ["hooks"],
				}),
				remote(root),
				projectDir,
			);

			expect(check).toEqual({
				ok: false,
				message: `symlink "hooks/lint/lib/leak" points outside the clone (target: ../../..)`,
			});
			await expect(copy).rejects.toThrow(
				`symlink "lib/leak" points outside the clone (target: ../../..)`,
			);
			expect(await installed(".claude/skills/a")).toBe(false);
			expect(await installed(".claude/hooks/lint")).toBe(false);
		});

		it("keeps a hook executable", async () => {
			await tree({
				"laravel/hooks/pre.sh": "",
				"laravel/hooks/lint/run.sh": "",
			});
			await chmod(join(root, "laravel/hooks/pre.sh"), 0o755);
			await chmod(join(root, "laravel/hooks/lint/run.sh"), 0o755);

			await copyFromCloneThenDelete();

			for (const hook of [
				".claude/hooks/pre.sh",
				".claude/hooks/lint/run.sh",
			]) {
				expect((await lstat(join(projectDir, hook))).mode & 0o777).toBe(0o755);
			}
		});

		it("installs only the regular .md files of agents/, never a link", async () => {
			await tree({ "laravel/agents/lead.md": "", "elsewhere/team/qa.md": "" });
			await symlink(
				"../../elsewhere/team/qa.md",
				join(root, "laravel/agents/qa.md"),
			);
			await symlink("../../elsewhere/team", join(root, "laravel/agents/team"));

			const result = await copyFromCloneThenDelete(
				pack({ assetDirs: ["agents"] }),
			);

			expect(result.copiedFiles).toEqual([".claude/agents/lead.md"]);
		});
	});
});

describe("listAgentFiles", () => {
	it("lists visible .md files at any depth, sorted", async () => {
		await tree({
			"agents/b.md": "",
			"agents/a/c.md": "",
			"agents/a/.hidden.md": "",
			"agents/z.txt": "",
		});

		expect(await listAgentFiles(join(root, "agents"))).toEqual([
			"a/c.md",
			"b.md",
		]);
	});

	it("is empty for a missing folder", async () => {
		expect(await listAgentFiles(join(root, "nope"))).toEqual([]);
	});
});
