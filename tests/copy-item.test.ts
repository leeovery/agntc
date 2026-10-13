import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyItem } from "../src/copy-item.js";

let base: string;
let root: string;
let projectDir: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), "agntc-copy-item-"));
	root = join(base, "source");
	projectDir = join(base, "project");
	await mkdir(projectDir, { recursive: true });
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

async function installed(path: string): Promise<boolean> {
	return access(join(projectDir, path)).then(
		() => true,
		() => false,
	);
}

async function linked(path: string): Promise<boolean> {
	return lstat(join(projectDir, path)).then(
		(stats) => stats.isSymbolicLink(),
		() => false,
	);
}

describe("copyItem", () => {
	it("copies a skill's whole folder, its own agents/ included, as one skill", async () => {
		await tree({
			"skills/swift/SKILL.md": "",
			"skills/swift/agents/openai.yaml": "",
		});

		const result = await copyItem(
			{ kind: "skill", skill: { name: "swift", path: "skills/swift" } },
			{ root, local: false },
			projectDir,
		);

		expect(result).toEqual({
			copiedFiles: [".claude/skills/swift/"],
			assetCounts: { skills: 1 },
		});
		expect(await installed(".claude/skills/swift/SKILL.md")).toBe(true);
		expect(await installed(".claude/skills/swift/agents/openai.yaml")).toBe(
			true,
		);
		expect(await installed(".claude/agents")).toBe(false);
	});

	describe("a skill's link to a folder beside it in the source", () => {
		const SWIFT = {
			kind: "skill",
			skill: { name: "swift", path: "skills/swift" },
		} as const;

		beforeEach(async () => {
			await tree({ "skills/swift/SKILL.md": "", "shared/guide.md": "guide" });
			await symlink("../../shared", join(root, "skills/swift/shared"));
		});

		it("is left out from a clone", async () => {
			await copyItem(SWIFT, { root, local: false }, projectDir);

			expect(await installed(".claude/skills/swift/SKILL.md")).toBe(true);
			expect(await linked(".claude/skills/swift/shared")).toBe(false);
		});

		it("links absolutely into a local source", async () => {
			await copyItem(SWIFT, { root, local: true }, projectDir);

			expect(
				await readlink(join(projectDir, ".claude/skills/swift/shared")),
			).toBe(join(root, "shared"));
			expect(
				await readFile(
					join(projectDir, ".claude/skills/swift/shared/guide.md"),
					"utf-8",
				),
			).toBe("guide");
		});
	});

	it("names a root skill after the root, not the source folder", async () => {
		await tree({ "SKILL.md": "" });

		const result = await copyItem(
			{ kind: "skill", skill: { name: "refero", path: "" } },
			{ root, local: false },
			projectDir,
		);

		expect(result.copiedFiles).toEqual([".claude/skills/refero/"]);
	});

	it("copies a pack through its skills, agents and hooks", async () => {
		await tree({
			"p/skills/a/SKILL.md": "",
			"p/agents/x.md": "",
		});

		const result = await copyItem(
			{
				kind: "pack",
				pack: {
					name: "p",
					path: "p",
					skills: [{ name: "a", path: "p/skills/a" }],
					assetDirs: ["agents"],
				},
			},
			{ root, local: false },
			projectDir,
		);

		expect(result).toEqual({
			copiedFiles: [".claude/skills/a/", ".claude/agents/x.md"],
			assetCounts: { skills: 1, agents: 1 },
		});
	});
});
