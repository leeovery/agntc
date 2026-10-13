import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPack, listAgentFiles } from "../src/copy-pack.js";
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
			root,
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
			root,
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
			root,
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
			root,
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
			root,
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

	it("leaves agents/ and hooks/ alone when the pack doesn't list them", async () => {
		await tree({
			"laravel/agents/notes.txt": "",
			"laravel/hooks/pre.sh": "",
		});

		const result = await copyPack(pack(), root, projectDir);

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
			root,
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
			root,
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
				root,
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
				copyPack(PACK_WITH_ASSETS, root, projectDir),
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
				copyPack(PACK_WITH_ASSETS, root, projectDir),
			).rejects.toThrow(".claude/hooks/lint is a symlink");

			expect(await readdir(realDir)).toEqual(["keep.md"]);
			expect(await installed(".claude/agents/team/lead.md")).toBe(false);
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
