import {
	access,
	mkdir,
	mkdtemp,
	readFile,
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

describe("copyItem", () => {
	it("copies a skill's whole folder, its own agents/ included, as one skill", async () => {
		await tree({
			"skills/swift/SKILL.md": "",
			"skills/swift/agents/openai.yaml": "",
		});

		const result = await copyItem(
			{ kind: "skill", skill: { name: "swift", path: "skills/swift" } },
			root,
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

	it("lets a skill's link reach anywhere in the source root, copying what it leads to", async () => {
		await tree({ "skills/swift/SKILL.md": "", "shared/guide.md": "guide" });
		await symlink("../../shared", join(root, "skills/swift/shared"));

		await copyItem(
			{ kind: "skill", skill: { name: "swift", path: "skills/swift" } },
			root,
			projectDir,
		);
		await rm(root, { recursive: true });

		expect(
			await readFile(
				join(projectDir, ".claude/skills/swift/shared/guide.md"),
				"utf-8",
			),
		).toBe("guide");
	});

	it("names a root skill after the root, not the source folder", async () => {
		await tree({ "SKILL.md": "" });

		const result = await copyItem(
			{ kind: "skill", skill: { name: "refero", path: "" } },
			root,
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
			root,
			projectDir,
		);

		expect(result).toEqual({
			copiedFiles: [".claude/skills/a/", ".claude/agents/x.md"],
			assetCounts: { skills: 1, agents: 1 },
		});
	});
});
