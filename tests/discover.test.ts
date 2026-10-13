import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathTraversalError } from "../src/copy-safety.js";
import {
	type DiscoverOptions,
	type Discovery,
	discover,
	type FoundPack,
	type FoundSkill,
	matchSkills,
	PackConflictError,
	StartPathError,
} from "../src/discover.js";

const PACK = JSON.stringify({ type: "pack" });
const PLUGIN = JSON.stringify({ type: "plugin" });

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agntc-discover-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Writes `path -> content` files under the root; a path ending in `/` is an empty dir. */
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

function skillsAt(...paths: string[]): Record<string, string> {
	return Object.fromEntries(paths.map((path) => [join(path, "SKILL.md"), ""]));
}

function run(options: Partial<DiscoverOptions> = {}): Promise<Discovery> {
	return discover(root, { rootName: "repo", ...options });
}

function paths(items: { path: string }[]): string[] {
	return items.map((item) => item.path);
}

describe("discover", () => {
	describe("skills", () => {
		it("returns the root as one skill named after the repo", async () => {
			await tree({
				"SKILL.md": "---\nname: fm-name\ndescription: Root skill\n---\n",
				"nested/SKILL.md": "",
			});

			expect(await run()).toEqual({
				packs: [],
				skills: [
					{
						name: "repo",
						path: "",
						frontmatterName: "fm-name",
						description: "Root skill",
					},
				],
				strays: [],
			});
		});

		it("records a skill by folder name and doesn't enter it", async () => {
			await tree(skillsAt("tools/lint", "tools/lint/inner"));

			const result = await run();

			expect(result.skills).toEqual([{ name: "lint", path: "tools/lint" }]);
		});

		it("carries frontmatter name and description, omitting absent fields", async () => {
			await tree({
				"a/SKILL.md": "---\nname: alpha\ndescription: First\n---\n",
				"b/SKILL.md": "---\ndescription: Second only\n---\n",
				"c/SKILL.md": "no frontmatter",
			});

			const [a, b, c] = (await run()).skills;

			expect(a).toStrictEqual({
				name: "a",
				path: "a",
				frontmatterName: "alpha",
				description: "First",
			});
			expect(b).toStrictEqual({
				name: "b",
				path: "b",
				description: "Second only",
			});
			expect(c).toStrictEqual({ name: "c", path: "c" });
		});

		it("treats category folders as plain folders", async () => {
			await tree(
				skillsAt("skills/review/pr", "skills/review/code", "skills/deploy/ci"),
			);

			const result = await run();

			expect(paths(result.skills)).toEqual([
				"skills/deploy/ci",
				"skills/review/code",
				"skills/review/pr",
			]);
		});

		it("keeps duplicate skill names found at different paths", async () => {
			await tree(skillsAt("one/shared", "two/shared"));

			const result = await run();

			expect(result.skills).toEqual([
				{ name: "shared", path: "one/shared" },
				{ name: "shared", path: "two/shared" },
			]);
		});

		it("treats a skill's agents/ holding only openai.yaml as part of the skill", async () => {
			await tree({
				"my-skill/SKILL.md": "",
				"my-skill/agents/openai.yaml": "",
			});

			const result = await run();

			expect(result).toEqual({
				packs: [],
				skills: [{ name: "my-skill", path: "my-skill" }],
				strays: [],
			});
		});

		it("never reports a skill's own agents/ or hooks/ as a stray", async () => {
			await tree({
				"my-skill/SKILL.md": "",
				"my-skill/agents/helper.md": "",
				"my-skill/hooks/run.sh": "",
			});

			expect((await run()).strays).toEqual([]);
		});
	});

	describe("depth", () => {
		it("finds a skill 5 levels below the start but not 6", async () => {
			await tree(skillsAt("a/b/c/d/five", "x/b/c/d/e/six"));

			const result = await run();

			expect(paths(result.skills)).toEqual(["a/b/c/d/five"]);
		});

		it("finds a pack 5 levels below the start but not 6", async () => {
			await tree({
				"a/b/c/d/five/agntc.json": PACK,
				"x/b/c/d/e/six/agntc.json": PACK,
			});

			const result = await run();

			expect(paths(result.packs)).toEqual(["a/b/c/d/five"]);
		});

		it("measures depth from the start path", async () => {
			await tree(skillsAt("base/a/b/c/d/five", "base/x/b/c/d/e/six"));

			const result = await run({ startPath: "base" });

			expect(paths(result.skills)).toEqual(["base/a/b/c/d/five"]);
		});

		it("measures a pack's skills from the pack's folder", async () => {
			await tree({
				"outer/pack/agntc.json": PACK,
				...skillsAt("outer/pack/a/b/c/d/five", "outer/pack/x/b/c/d/e/six"),
			});

			const [pack] = (await run()).packs;

			expect(paths(pack?.skills ?? [])).toEqual(["outer/pack/a/b/c/d/five"]);
		});
	});

	describe("skipped folders", () => {
		it.each([
			".git",
			".github",
			"node_modules",
			"dist",
			"build",
			"vendor",
		])("skips %s", async (skipped) => {
			await tree({
				...skillsAt(`${skipped}/hidden-skill`, "kept"),
				[`${skipped}/pack/agntc.json`]: PACK,
				[`${skipped}/agents/a.md`]: "",
			});

			expect(await run()).toEqual({
				packs: [],
				skills: [{ name: "kept", path: "kept" }],
				strays: [],
			});
		});

		it("skips them inside a pack too", async () => {
			await tree({
				"agntc.json": PACK,
				...skillsAt("node_modules/dep", ".hidden/s", "real"),
			});

			const [pack] = (await run()).packs;

			expect(paths(pack?.skills ?? [])).toEqual(["real"]);
		});

		it("doesn't follow a symlinked directory", async () => {
			await tree({
				...skillsAt(".store/linked-skill", ".store/group/inner"),
				".store/pack/agntc.json": PACK,
			});
			await symlink(
				join(root, ".store/linked-skill"),
				join(root, "skill-link"),
			);
			await symlink(join(root, ".store/group"), join(root, "group-link"));
			await symlink(join(root, ".store/pack"), join(root, "pack-link"));

			expect(await run()).toEqual({ packs: [], skills: [], strays: [] });
		});
	});

	describe("packs", () => {
		const V1_PLUGIN = {
			...skillsAt("skills/b", "skills/a"),
			"agents/reviewer.md": "",
			"hooks/pre.sh": "",
		};

		it("reads a v1 plugin root with no type as loose skills plus a stray at the root", async () => {
			await tree(V1_PLUGIN);

			expect(await run()).toEqual({
				packs: [],
				skills: [
					{ name: "a", path: "skills/a" },
					{ name: "b", path: "skills/b" },
				],
				strays: [{ path: "", assetDirs: ["agents", "hooks"] }],
			});
		});

		it.each([
			["pack", PACK],
			["plugin", PLUGIN],
		])('reads type "%s" as one pack', async (_, config) => {
			await tree({ ...V1_PLUGIN, "agntc.json": config });

			expect(await run()).toEqual({
				packs: [
					{
						name: "repo",
						path: "",
						skills: [
							{ name: "a", path: "skills/a" },
							{ name: "b", path: "skills/b" },
						],
						assetDirs: ["agents", "hooks"],
					},
				],
				skills: [],
				strays: [],
			});
		});

		it("ignores any other type silently", async () => {
			const onWarn = vi.fn();
			await tree({
				...skillsAt("skills/a"),
				"agntc.json": '{"type":"collection"}',
			});

			const result = await run({ onWarn });

			expect(result.packs).toEqual([]);
			expect(paths(result.skills)).toEqual(["skills/a"]);
			expect(onWarn).not.toHaveBeenCalled();
		});

		it("never makes a pack from an agntc.json without a type", async () => {
			await tree({
				...skillsAt("p/skills/a"),
				"p/agntc.json": '{"agents":["claude"]}',
			});

			const result = await run();

			expect(result.packs).toEqual([]);
			expect(paths(result.skills)).toEqual(["p/skills/a"]);
		});

		it("passes readConfig warnings through onWarn", async () => {
			const onWarn = vi.fn();
			await tree({ ...skillsAt("p/s"), "p/agntc.json": "{not json" });

			const result = await run({ onWarn });

			expect(result.packs).toEqual([]);
			expect(onWarn).toHaveBeenCalledWith(
				expect.stringContaining("malformed agntc.json"),
			);
		});

		it("reads plugins/<p>/skills/<s> as a pack when p is declared", async () => {
			await tree({
				"plugins/p/agntc.json": PACK,
				...skillsAt("plugins/p/skills/s", "loose"),
			});

			expect(await run()).toEqual({
				packs: [
					{
						name: "p",
						path: "plugins/p",
						skills: [{ name: "s", path: "plugins/p/skills/s" }],
						assetDirs: [],
					},
				],
				skills: [{ name: "loose", path: "loose" }],
				strays: [],
			});
		});

		it("reads plugins/<p>/skills/<s> as a loose skill when p isn't declared", async () => {
			await tree(skillsAt("plugins/p/skills/s"));

			expect(await run()).toEqual({
				packs: [],
				skills: [{ name: "s", path: "plugins/p/skills/s" }],
				strays: [],
			});
		});

		it("doesn't nest packs: an inner pack's skills belong to the outer pack", async () => {
			await tree({
				"outer/agntc.json": PACK,
				"outer/inner/agntc.json": PACK,
				"outer/inner/agents/nested.md": "",
				...skillsAt("outer/own", "outer/inner/deep"),
			});

			expect(await run()).toEqual({
				packs: [
					{
						name: "outer",
						path: "outer",
						skills: [
							{ name: "deep", path: "outer/inner/deep" },
							{ name: "own", path: "outer/own" },
						],
						assetDirs: [],
					},
				],
				skills: [],
				strays: [],
			});
		});

		it("doesn't search the pack's own top-level agents/ and hooks/ for skills", async () => {
			await tree({
				"agntc.json": PACK,
				...skillsAt("agents/not-a-skill", "hooks/nor-this", "sub/agents/found"),
			});

			const [pack] = (await run()).packs;

			expect(paths(pack?.skills ?? [])).toEqual(["sub/agents/found"]);
		});

		it("carries frontmatter on a pack's skills", async () => {
			await tree({
				"agntc.json": PACK,
				"s/SKILL.md": "---\nname: fm\ndescription: Inside a pack\n---\n",
			});

			const [pack] = (await run()).packs;

			expect(pack?.skills).toEqual([
				{
					name: "s",
					path: "s",
					frontmatterName: "fm",
					description: "Inside a pack",
				},
			]);
		});
	});

	describe("pack assetDirs", () => {
		async function assetDirsOf(spec: Record<string, string>) {
			await tree({ "agntc.json": PACK, ...spec });
			const [pack] = (await run()).packs;
			return pack?.assetDirs;
		}

		it("lists agents for a .md file anywhere beneath agents/", async () => {
			expect(await assetDirsOf({ "agents/group/deep/a.md": "" })).toEqual([
				"agents",
			]);
		});

		it("doesn't list agents when agents/ holds no .md file", async () => {
			expect(
				await assetDirsOf({ "agents/openai.yaml": "", "agents/sub/x.txt": "" }),
			).toEqual([]);
		});

		it("lists hooks for any regular file anywhere beneath hooks/", async () => {
			expect(await assetDirsOf({ "hooks/nested/run.sh": "" })).toEqual([
				"hooks",
			]);
		});

		it("doesn't list hooks when hooks/ holds only empty folders", async () => {
			expect(await assetDirsOf({ "hooks/empty/": "" })).toEqual([]);
		});

		it("lists agents before hooks", async () => {
			expect(
				await assetDirsOf({ "hooks/h.sh": "", "agents/a.md": "" }),
			).toEqual(["agents", "hooks"]);
		});

		it("ignores a symlinked agents/ folder", async () => {
			await tree({ ".real/a.md": "" });
			await symlink(join(root, ".real"), join(root, "agents"));

			expect(await assetDirsOf({})).toEqual([]);
		});
	});

	describe("strays", () => {
		it("reports a plain folder with agents/ or hooks/ while its skills stay loose", async () => {
			await tree({
				"group/agents/a.md": "",
				"other/hooks/run.sh": "",
				...skillsAt("group/skills/s"),
			});

			expect(await run()).toEqual({
				packs: [],
				skills: [{ name: "s", path: "group/skills/s" }],
				strays: [
					{ path: "group", assetDirs: ["agents"] },
					{ path: "other", assetDirs: ["hooks"] },
				],
			});
		});

		it("doesn't report agents/ or hooks/ that don't qualify", async () => {
			await tree({ "group/agents/openai.yaml": "", "group/hooks/empty/": "" });

			expect((await run()).strays).toEqual([]);
		});

		it("doesn't report folders inside a pack", async () => {
			await tree({
				"p/agntc.json": PACK,
				"p/sub/agents/a.md": "",
			});

			expect((await run()).strays).toEqual([]);
		});
	});

	describe("ordering", () => {
		it("sorts packs, skills, strays and a pack's skills by path", async () => {
			await tree({
				...skillsAt("a/x", "a-b", "p/z/s", "p/z-y"),
				"p/agntc.json": PACK,
				"q-r/agntc.json": PACK,
				"q/r/agntc.json": PACK,
				"m/sub/agents/a.md": "",
				"m-n/agents/a.md": "",
			});

			const result = await run();

			expect(paths(result.packs)).toEqual(["p", "q-r", "q/r"]);
			expect(paths(result.packs[0]?.skills ?? [])).toEqual(["p/z-y", "p/z/s"]);
			expect(paths(result.skills)).toEqual(["a-b", "a/x"]);
			expect(paths(result.strays)).toEqual(["m-n", "m/sub"]);
		});
	});

	describe("startPath", () => {
		it("returns the one pack when it names a pack", async () => {
			await tree({
				"plugins/p/agntc.json": PACK,
				"plugins/p/agents/a.md": "",
				...skillsAt("plugins/p/skills/s", "elsewhere"),
			});

			expect(await run({ startPath: "plugins/p" })).toEqual({
				packs: [
					{
						name: "p",
						path: "plugins/p",
						skills: [{ name: "s", path: "plugins/p/skills/s" }],
						assetDirs: ["agents"],
					},
				],
				skills: [],
				strays: [],
			});
		});

		it("returns the one skill when it names a skill", async () => {
			await tree({
				"skills/s/SKILL.md": "---\ndescription: Picked\n---\n",
				...skillsAt("skills/other"),
			});

			expect(await run({ startPath: "skills/s" })).toEqual({
				packs: [],
				skills: [{ name: "s", path: "skills/s", description: "Picked" }],
				strays: [],
			});
		});

		it("walks below a category folder with repo-relative paths", async () => {
			await tree(
				skillsAt("skills/review/pr", "skills/review/code", "skills/x"),
			);

			const result = await run({ startPath: "skills/review" });

			expect(paths(result.skills)).toEqual([
				"skills/review/code",
				"skills/review/pr",
			]);
		});

		it("normalises a trailing slash and ./ prefix", async () => {
			await tree(skillsAt("skills/s"));

			const result = await run({ startPath: "./skills/s/" });

			expect(result.skills).toEqual([{ name: "s", path: "skills/s" }]);
		});

		it("throws naming the path when it doesn't exist", async () => {
			await expect(run({ startPath: "foo/bar" })).rejects.toThrow(
				new StartPathError('path "foo/bar" not found in source'),
			);
		});

		it("throws naming the path when it isn't a directory", async () => {
			await tree({ "README.md": "" });

			await expect(run({ startPath: "README.md" })).rejects.toThrow(
				new StartPathError('path "README.md" is not a directory in source'),
			);
		});

		it("throws when it reaches through a symlinked directory", async () => {
			await tree(skillsAt(".store/s"));
			await symlink(join(root, ".store"), join(root, "link"));

			await expect(run({ startPath: "link/s" })).rejects.toThrow(
				StartPathError,
			);
		});

		it("throws PathTraversalError when it escapes the root", async () => {
			await expect(run({ startPath: "../escape" })).rejects.toThrow(
				PathTraversalError,
			);
		});
	});

	describe("forcePack", () => {
		it("refuses a root that is a skill, naming the repo", async () => {
			await tree({ "SKILL.md": "" });

			await expect(run({ forcePack: true })).rejects.toThrow(
				new PackConflictError(
					`"repo" is a single skill — --pack can't bundle it`,
				),
			);
		});

		it("refuses a start path that is a skill, naming the path", async () => {
			await tree(skillsAt("skills/s"));

			await expect(
				run({ startPath: "skills/s", forcePack: true }),
			).rejects.toThrow(
				new PackConflictError(
					`"skills/s" is a single skill — --pack can't bundle it`,
				),
			);
		});

		it("refuses a folder containing declared packs, listing them", async () => {
			await tree({
				"plugins/b/agntc.json": PACK,
				"plugins/a/agntc.json": PLUGIN,
				...skillsAt("skills/s"),
			});

			await expect(run({ forcePack: true })).rejects.toThrow(
				new PackConflictError(
					`"repo" contains packs (plugins/a, plugins/b) — --pack can't bundle it`,
				),
			);
		});

		it("returns the same result as without the flag on a declared pack", async () => {
			await tree({
				"p/agntc.json": PACK,
				"p/hooks/h.sh": "",
				...skillsAt("p/s"),
			});

			const forced = await run({ startPath: "p", forcePack: true });

			expect(forced).toEqual(await run({ startPath: "p" }));
		});

		it("bundles a plain folder as one pack with no loose skills or strays", async () => {
			await tree({
				...skillsAt("skills/b", "skills/a", "agents/inside/s"),
				"agents/reviewer.md": "",
				"hooks/pre.sh": "",
				"group/agents/stray.md": "",
			});

			expect(await run({ forcePack: true })).toEqual({
				packs: [
					{
						name: "repo",
						path: "",
						skills: [
							{ name: "a", path: "skills/a" },
							{ name: "b", path: "skills/b" },
						],
						assetDirs: ["agents", "hooks"],
					},
				],
				skills: [],
				strays: [],
			});
		});

		it("bundles a start path folder, named by its basename", async () => {
			await tree(skillsAt("laravel/skills/a"));

			const result = await run({ startPath: "laravel", forcePack: true });

			expect(result.packs).toEqual([
				{
					name: "laravel",
					path: "laravel",
					skills: [{ name: "a", path: "laravel/skills/a" }],
					assetDirs: [],
				},
			]);
		});

		it("returns an empty pack for an empty folder", async () => {
			expect(await run({ forcePack: true })).toEqual({
				packs: [{ name: "repo", path: "", skills: [], assetDirs: [] }],
				skills: [],
				strays: [],
			});
		});
	});
});

describe("matchSkills", () => {
	function skill(path: string, frontmatterName?: string): FoundSkill {
		const name = path.split("/").pop() ?? path;
		return frontmatterName === undefined
			? { name, path }
			: { name, path, frontmatterName };
	}

	function pack(path: string, skills: FoundSkill[]): FoundPack {
		return { name: path, path, skills, assetDirs: [] };
	}

	function discovery(skills: FoundSkill[], packs: FoundPack[] = []): Discovery {
		return { packs, skills, strays: [] };
	}

	it("matches a folder name", () => {
		const s = skill("skills/review");

		expect(matchSkills(discovery([s]), ["review"])).toEqual({
			matched: [{ skill: s }],
			missing: [],
			ambiguous: [],
		});
	});

	it("matches a frontmatter name", () => {
		const s = skill("skills/review", "code-review");

		expect(matchSkills(discovery([s]), ["code-review"]).matched).toEqual([
			{ skill: s },
		]);
	});

	it("matches a skill inside a pack, carrying the pack", () => {
		const s = skill("p/skills/inner");
		const p = pack("p", [s]);

		expect(matchSkills(discovery([], [p]), ["inner"]).matched).toEqual([
			{ skill: s, pack: p },
		]);
	});

	it("matches case-sensitively", () => {
		const result = matchSkills(discovery([skill("Review")]), ["review"]);

		expect(result.matched).toEqual([]);
		expect(result.missing).toEqual(["review"]);
	});

	it("counts a skill matched by folder and frontmatter name once", () => {
		const s = skill("a/review", "review");

		expect(matchSkills(discovery([s]), ["review"])).toEqual({
			matched: [{ skill: s }],
			missing: [],
			ambiguous: [],
		});
	});

	it("doesn't duplicate a skill wanted under both its names", () => {
		const s = skill("a/review", "code-review");

		expect(
			matchSkills(discovery([s]), ["review", "code-review", "review"]).matched,
		).toEqual([{ skill: s }]);
	});

	it("reports a name found at several paths as ambiguous, listing every path", () => {
		const loose = skill("one/shared");
		const packed = skill("p/two/shared");
		const byFrontmatter = skill("three/other", "shared");

		const result = matchSkills(
			discovery([loose, byFrontmatter], [pack("p", [packed])]),
			["shared"],
		);

		expect(result).toEqual({
			matched: [],
			missing: [],
			ambiguous: [
				{
					name: "shared",
					paths: ["one/shared", "p/two/shared", "three/other"],
				},
			],
		});
	});

	it("reports names with no match as missing", () => {
		const result = matchSkills(discovery([skill("a")]), ["a", "nope", "gone"]);

		expect(result.missing).toEqual(["nope", "gone"]);
	});

	it("keeps matched in wanted order", () => {
		const a = skill("x/a");
		const b = skill("y/b");
		const c = skill("z/c");

		expect(matchSkills(discovery([a, b, c]), ["c", "a", "b"]).matched).toEqual([
			{ skill: c },
			{ skill: a },
			{ skill: b },
		]);
	});
});
