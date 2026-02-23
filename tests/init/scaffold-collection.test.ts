import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldCollection } from "../../src/init/scaffold-collection.js";

const SKILL_MD_TEMPLATE = `---
name: my-skill
description: Brief description of what this skill does and when to use it.
---

# My Skill

## Instructions

[Describe what the agent should do when this skill is invoked]
`;

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("scaffoldCollection", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-collection-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("creates my-plugin/ subtree in empty directory", async () => {
		await scaffoldCollection({ agents: ["claude"], targetDir: testDir });

		expect(await exists(join(testDir, "my-plugin", "agntc.json"))).toBe(true);
		expect(
			await exists(
				join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			),
		).toBe(true);
		expect(await exists(join(testDir, "my-plugin", "agents"))).toBe(true);
		expect(await exists(join(testDir, "my-plugin", "hooks"))).toBe(true);
	});

	it("does not create root agntc.json", async () => {
		await scaffoldCollection({ agents: ["claude"], targetDir: testDir });

		expect(await exists(join(testDir, "agntc.json"))).toBe(false);
	});

	it("my-plugin/agntc.json content matches agent selection", async () => {
		await scaffoldCollection({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(
			join(testDir, "my-plugin", "agntc.json"),
			"utf-8",
		);
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("my-plugin/skills/my-skill/SKILL.md matches spec template", async () => {
		await scaffoldCollection({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(
			join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(SKILL_MD_TEMPLATE);
	});

	it("skips my-plugin/agntc.json when it already exists", async () => {
		const original = '{"agents": ["codex"]}\n';
		await mkdir(join(testDir, "my-plugin"), { recursive: true });
		await writeFile(join(testDir, "my-plugin", "agntc.json"), original);

		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
		});

		const content = await readFile(
			join(testDir, "my-plugin", "agntc.json"),
			"utf-8",
		);
		expect(content).toBe(original);
		expect(result.skipped).toContain("my-plugin/agntc.json");
		expect(result.created).not.toContain("my-plugin/agntc.json");
	});

	it("checks items individually when my-plugin/ already exists", async () => {
		await mkdir(join(testDir, "my-plugin", "agents"), { recursive: true });

		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.skipped).toContain("my-plugin/agents/");
		expect(result.created).toContain("my-plugin/agntc.json");
		expect(result.created).toContain("my-plugin/skills/my-skill/SKILL.md");
		expect(result.created).toContain("my-plugin/hooks/");
	});

	it("return paths all prefixed with my-plugin/", async () => {
		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
		});

		const allPaths = [...result.created, ...result.skipped];
		for (const p of allPaths) {
			expect(p).toMatch(/^my-plugin\//);
		}
		expect(allPaths).toHaveLength(4);
	});

	it("fresh mode returns empty overwritten array", async () => {
		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.overwritten).toEqual([]);
	});

	it("scaffoldCollection overwrites my-plugin/agntc.json when reconfigure is true", async () => {
		const original = '{"agents": ["codex"]}\n';
		await mkdir(join(testDir, "my-plugin"), { recursive: true });
		await writeFile(join(testDir, "my-plugin", "agntc.json"), original);

		await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		const content = await readFile(
			join(testDir, "my-plugin", "agntc.json"),
			"utf-8",
		);
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("scaffoldCollection skips SKILL.md even in reconfigure mode", async () => {
		const original = "# Existing skill\n";
		await mkdir(join(testDir, "my-plugin", "skills", "my-skill"), {
			recursive: true,
		});
		await writeFile(join(testDir, "my-plugin", "agntc.json"), "{}");
		await writeFile(
			join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			original,
		);

		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		const content = await readFile(
			join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(original);
		expect(result.skipped).toContain("my-plugin/skills/my-skill/SKILL.md");
	});

	it("scaffoldCollection reports my-plugin/agntc.json as overwritten", async () => {
		await mkdir(join(testDir, "my-plugin"), { recursive: true });
		await writeFile(join(testDir, "my-plugin", "agntc.json"), "{}");

		const result = await scaffoldCollection({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		expect(result.overwritten).toContain("my-plugin/agntc.json");
		expect(result.created).not.toContain("my-plugin/agntc.json");
		expect(result.skipped).not.toContain("my-plugin/agntc.json");
	});
});
