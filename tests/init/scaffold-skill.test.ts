import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldSkill } from "../../src/init/scaffold-skill.js";

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

describe("scaffoldSkill", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-skill-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("writes SKILL.md with frontmatter template", async () => {
		await scaffoldSkill({ targetDir: testDir });

		const content = await readFile(join(testDir, "SKILL.md"), "utf-8");
		expect(content).toBe(SKILL_MD_TEMPLATE);
	});

	it("does not write agntc.json", async () => {
		await scaffoldSkill({ targetDir: testDir });

		expect(await exists(join(testDir, "agntc.json"))).toBe(false);
	});

	it("leaves an existing agntc.json untouched and unreported", async () => {
		const original = '{"agents": ["claude"]}\n';
		await writeFile(join(testDir, "agntc.json"), original);

		const result = await scaffoldSkill({ targetDir: testDir });

		expect(await readFile(join(testDir, "agntc.json"), "utf-8")).toBe(original);
		expect(result.created).not.toContain("agntc.json");
		expect(result.skipped).not.toContain("agntc.json");
	});

	it("skips SKILL.md when it already exists", async () => {
		const original = "# Existing skill\n";
		await writeFile(join(testDir, "SKILL.md"), original);

		const result = await scaffoldSkill({ targetDir: testDir });

		const content = await readFile(join(testDir, "SKILL.md"), "utf-8");
		expect(content).toBe(original);
		expect(result).toEqual({ created: [], skipped: ["SKILL.md"] });
	});

	it("reports created files correctly", async () => {
		const result = await scaffoldSkill({ targetDir: testDir });

		expect(result).toEqual({ created: ["SKILL.md"], skipped: [] });
	});
});
