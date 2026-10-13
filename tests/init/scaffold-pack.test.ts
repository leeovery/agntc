import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyPack } from "../../src/copy-pack.js";
import { discover } from "../../src/discover.js";
import { parseFrontmatter } from "../../src/frontmatter.js";
import { packScaffold } from "../../src/init/scaffold-pack.js";
import { writeScaffold } from "../../src/init/scaffold-utils.js";

describe("packScaffold", () => {
	let testDir: string;
	let packDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-pack-test-"));
		packDir = join(testDir, "my-pack");
		await mkdir(packDir);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	async function scaffold(): Promise<void> {
		await writeScaffold(packDir, packScaffold.files(packDir));
	}

	async function read(path: string): Promise<string> {
		return readFile(join(packDir, path), "utf-8");
	}

	it("declares the pack, with one example skill, agent and hook", () => {
		const paths = packScaffold.files(packDir).map(({ path }) => path);

		expect(paths).toEqual([
			"agntc.json",
			"skills/my-skill/SKILL.md",
			"agents/my-agent.md",
			"hooks/my-hook.sh",
		]);
	});

	it('writes agntc.json holding exactly {"type": "pack"}', async () => {
		await scaffold();

		expect(JSON.parse(await read("agntc.json"))).toEqual({ type: "pack" });
	});

	it("names the example skill after its folder", async () => {
		await scaffold();

		expect(parseFrontmatter(await read("skills/my-skill/SKILL.md"))).toEqual({
			name: "my-skill",
			description:
				"Brief description of what this skill does and when to use it.",
		});
	});

	it("gives the example agent a name and description", async () => {
		await scaffold();

		expect(parseFrontmatter(await read("agents/my-agent.md"))).toEqual({
			name: "my-agent",
			description:
				"Brief description of what this agent does and when to use it.",
		});
	});

	it("makes the example hook executable", async () => {
		await scaffold();

		const { mode } = await stat(join(packDir, "hooks", "my-hook.sh"));
		expect(mode & 0o111).toBe(0o111);
	});

	it("is what discovery finds as one pack holding the skill, agents and hooks", async () => {
		await scaffold();

		const discovery = await discover(packDir, { rootName: "my-pack" });

		expect(discovery).toEqual({
			packs: [
				{
					name: "my-pack",
					path: "",
					skills: [
						{
							name: "my-skill",
							path: "skills/my-skill",
							frontmatterName: "my-skill",
							description:
								"Brief description of what this skill does and when to use it.",
						},
					],
					assetDirs: ["agents", "hooks"],
				},
			],
			skills: [],
			strays: [],
		});
	});

	it("installs its skill, its agent and its hook", async () => {
		await scaffold();
		const projectDir = join(testDir, "project");
		const [pack] = (await discover(packDir, { rootName: "my-pack" })).packs;
		if (pack === undefined) {
			throw new Error("the scaffold isn't a pack");
		}

		const result = await copyPack(
			pack,
			{ root: packDir, local: true },
			projectDir,
		);

		expect(result.copiedFiles).toEqual([
			".claude/skills/my-skill/",
			".claude/agents/my-agent.md",
			".claude/hooks/my-hook.sh",
		]);
		expect(result.assetCounts).toEqual({ skills: 1, agents: 1, hooks: 1 });
		for (const installed of [
			".claude/skills/my-skill/SKILL.md",
			".claude/agents/my-agent.md",
			".claude/hooks/my-hook.sh",
		]) {
			expect(await readFile(join(projectDir, installed), "utf-8")).toBe(
				await read(installed.replace(/^\.claude\//, "")),
			);
		}
		const hook = await stat(join(projectDir, ".claude", "hooks", "my-hook.sh"));
		expect(hook.mode & 0o111).toBe(0o111);
	});

	it("has nothing to warn about once scaffolded", async () => {
		await scaffold();

		expect(await packScaffold.warnings(packDir)).toEqual([]);
	});

	it('has nothing to warn about when an agntc.json already there declares the legacy "plugin"', async () => {
		await writeFile(join(packDir, "agntc.json"), '{"type": "plugin"}');
		await scaffold();

		expect(await packScaffold.warnings(packDir)).toEqual([]);
		expect((await discover(packDir, { rootName: "my-pack" })).packs).toEqual([
			expect.objectContaining({ path: "" }),
		]);
	});

	it.each([
		["declares nothing", "{}"],
		["isn't JSON", "not json"],
		["declares another type", '{"type": "skill"}'],
	])("warns when an agntc.json already there %s", async (_, content) => {
		await writeFile(join(packDir, "agntc.json"), content);
		await scaffold();

		expect(await read("agntc.json")).toBe(content);
		expect(await packScaffold.warnings(packDir)).toEqual([
			'agntc.json was already here and doesn\'t declare a pack — add "type": "pack" to it',
		]);
	});

	it("warns when a SKILL.md already there makes the folder a skill", async () => {
		await writeFile(join(packDir, "SKILL.md"), "# Mine\n");
		await scaffold();

		expect(await packScaffold.warnings(packDir)).toEqual([
			"SKILL.md here makes this folder a skill, not a pack — move it under skills/",
		]);
	});

	it("never says plugin or collection in what it writes", async () => {
		const contents = packScaffold.files(packDir).map(({ content }) => content);

		expect(contents.join("\n")).not.toMatch(/plugin|collection/i);
	});
});
