import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeClaims,
	computeIncomingFiles,
	describeClash,
	findTargetClashes,
	skillClaims,
} from "../src/compute-incoming-files.js";
import { copyItem } from "../src/copy-item.js";
import type { FoundPack } from "../src/discover.js";
import type { InstallItem } from "../src/install-item.js";

let base: string;
let root: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), "agntc-incoming-"));
	root = join(base, "source");
	await mkdir(root, { recursive: true });
});

afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

async function tree(spec: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(spec)) {
		const full = join(root, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

function packItem(overrides: Partial<FoundPack> = {}): InstallItem {
	return {
		kind: "pack",
		pack: { name: "p", path: "p", skills: [], assetDirs: [], ...overrides },
	};
}

describe("computeIncomingFiles", () => {
	describe("skill", () => {
		it("claims .claude/skills/<folder name>/", async () => {
			const result = await computeIncomingFiles(
				{ kind: "skill", skill: { name: "hooks", path: "skills/react/hooks" } },
				root,
			);

			expect(result).toEqual([".claude/skills/hooks/"]);
		});

		it("claims the root's name for a skill at the root", async () => {
			const result = await computeIncomingFiles(
				{ kind: "skill", skill: { name: "refero-design", path: "" } },
				"/tmp/agntc-Xy12ab",
			);

			expect(result).toEqual([".claude/skills/refero-design/"]);
		});
	});

	describe("pack", () => {
		it("claims each skill, each .md agent and each top-level hook entry", async () => {
			await tree({
				"p/skills/a/SKILL.md": "",
				"p/agents/reviewer.md": "",
				"p/agents/nested/planner.md": "",
				"p/agents/openai.yaml": "",
				"p/hooks/pre.sh": "",
				"p/hooks/lint/run.sh": "",
			});

			const result = await computeIncomingFiles(
				packItem({
					skills: [{ name: "a", path: "p/skills/a" }],
					assetDirs: ["agents", "hooks"],
				}),
				root,
			);

			expect([...result].sort()).toEqual([
				".claude/agents/nested/planner.md",
				".claude/agents/reviewer.md",
				".claude/hooks/lint/",
				".claude/hooks/pre.sh",
				".claude/skills/a/",
			]);
		});

		it("claims nothing from agents/ or hooks/ the pack doesn't list", async () => {
			await tree({ "p/agents/a.md": "", "p/hooks/h.sh": "" });

			expect(await computeIncomingFiles(packItem(), root)).toEqual([]);
		});

		it("predicts the top-level paths copying claims", async () => {
			await tree({
				"p/skills/a/SKILL.md": "",
				"p/agents/x.md": "",
				"p/hooks/h.sh": "",
			});
			const item = packItem({
				skills: [{ name: "a", path: "p/skills/a" }],
				assetDirs: ["agents", "hooks"],
			});
			const projectDir = join(base, "project");

			const incoming = await computeIncomingFiles(item, root);
			const { copiedFiles } = await copyItem(item, root, projectDir);

			expect([...incoming].sort()).toEqual([...copiedFiles].sort());
		});
	});
});

describe("computeClaims", () => {
	it("names the source path behind each claimed install path", async () => {
		await tree({
			"p/skills/a/SKILL.md": "",
			"p/agents/nested/planner.md": "",
			"p/hooks/pre.sh": "",
		});

		const claims = await computeClaims(
			packItem({
				skills: [{ name: "a", path: "p/skills/a" }],
				assetDirs: ["agents", "hooks"],
			}),
			root,
		);

		expect(claims).toEqual([
			{ target: ".claude/skills/a/", source: "p/skills/a" },
			{
				target: ".claude/agents/nested/planner.md",
				source: "p/agents/nested/planner.md",
			},
			{ target: ".claude/hooks/pre.sh", source: "p/hooks/pre.sh" },
		]);
	});

	it("names a root pack's assets from the root", async () => {
		await tree({ "agents/x.md": "" });

		const claims = await computeClaims(
			packItem({ path: "", assetDirs: ["agents"] }),
			root,
		);

		expect(claims).toEqual([
			{ target: ".claude/agents/x.md", source: "agents/x.md" },
		]);
	});
});

describe("findTargetClashes", () => {
	it("finds each install path claimed more than once, with every source claiming it", () => {
		const clashes = findTargetClashes([
			...skillClaims([
				{ name: "foo", path: "skills/a/foo" },
				{ name: "bar", path: "bar" },
				{ name: "foo", path: "tools/foo" },
			]),
			{ target: ".claude/agents/x.md", source: "p/agents/x.md" },
			{ target: ".claude/agents/x.md", source: "q/agents/x.md" },
		]);

		expect(clashes).toEqual([
			{
				target: ".claude/skills/foo",
				sources: ["skills/a/foo", "tools/foo"],
			},
			{
				target: ".claude/agents/x.md",
				sources: ["p/agents/x.md", "q/agents/x.md"],
			},
		]);
	});

	it("matches a hook file against a hook folder of the same name", () => {
		const clashes = findTargetClashes([
			{ target: ".claude/hooks/lint", source: "p/hooks/lint" },
			{ target: ".claude/hooks/lint/", source: "q/hooks/lint" },
		]);

		expect(clashes).toEqual([
			{
				target: ".claude/hooks/lint",
				sources: ["p/hooks/lint", "q/hooks/lint"],
			},
		]);
	});

	it("finds nothing when every install path is claimed once", () => {
		expect(
			findTargetClashes(
				skillClaims([
					{ name: "a", path: "a" },
					{ name: "b", path: "skills/b" },
				]),
			),
		).toEqual([]);
	});
});

describe("describeClash", () => {
	it("names both paths and the install path they share", () => {
		expect(
			describeClash({
				target: ".claude/skills/foo",
				sources: ["skills/a/foo", "tools/foo"],
			}),
		).toBe(
			"skills/a/foo and tools/foo would both install to .claude/skills/foo",
		);
	});

	it("says all for more than two", () => {
		expect(
			describeClash({
				target: ".claude/skills/foo",
				sources: ["a/foo", "b/foo", "c/foo"],
			}),
		).toBe("a/foo, b/foo and c/foo would all install to .claude/skills/foo");
	});
});
