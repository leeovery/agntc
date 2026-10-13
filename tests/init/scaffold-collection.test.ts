import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

	it("creates the my-plugin/ subtree in an empty directory, with no agntc.json", async () => {
		await scaffoldCollection({ targetDir: testDir });

		expect(await exists(join(testDir, "my-plugin", "agntc.json"))).toBe(false);
		expect(
			await exists(
				join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			),
		).toBe(true);
		expect(await exists(join(testDir, "my-plugin", "agents"))).toBe(true);
		expect(await exists(join(testDir, "my-plugin", "hooks"))).toBe(true);
	});

	it("does not create root agntc.json", async () => {
		await scaffoldCollection({ targetDir: testDir });

		expect(await exists(join(testDir, "agntc.json"))).toBe(false);
	});

	it("my-plugin/skills/my-skill/SKILL.md matches spec template", async () => {
		await scaffoldCollection({ targetDir: testDir });

		const content = await readFile(
			join(testDir, "my-plugin", "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(SKILL_MD_TEMPLATE);
	});

	it("checks items individually when my-plugin/ already exists", async () => {
		await mkdir(join(testDir, "my-plugin", "agents"), { recursive: true });

		const result = await scaffoldCollection({ targetDir: testDir });

		expect(result.skipped).toContain("my-plugin/agents/");
		expect(result.created).toContain("my-plugin/skills/my-skill/SKILL.md");
		expect(result.created).toContain("my-plugin/hooks/");
	});

	it("return paths all prefixed with my-plugin/", async () => {
		const result = await scaffoldCollection({ targetDir: testDir });

		const allPaths = [...result.created, ...result.skipped];
		for (const p of allPaths) {
			expect(p).toMatch(/^my-plugin\//);
		}
		expect(allPaths).toHaveLength(3);
	});
});
