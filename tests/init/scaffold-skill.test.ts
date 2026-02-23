import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("scaffoldSkill", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-skill-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("writes agntc.json with selected agents", async () => {
		await scaffoldSkill({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("writes agntc.json with both agents when both selected", async () => {
		await scaffoldSkill({
			agents: ["claude", "codex"],
			targetDir: testDir,
		});

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe(
			'{\n  "agents": [\n    "claude",\n    "codex"\n  ]\n}\n',
		);
	});

	it("writes SKILL.md with frontmatter template", async () => {
		await scaffoldSkill({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(join(testDir, "SKILL.md"), "utf-8");
		expect(content).toBe(SKILL_MD_TEMPLATE);
	});

	it("skips agntc.json when it already exists", async () => {
		const original = '{"agents": ["codex"]}\n';
		await writeFile(join(testDir, "agntc.json"), original);

		const result = await scaffoldSkill({
			agents: ["claude"],
			targetDir: testDir,
		});

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe(original);
		expect(result.skipped).toContain("agntc.json");
		expect(result.created).not.toContain("agntc.json");
	});

	it("skips SKILL.md when it already exists", async () => {
		const original = "# Existing skill\n";
		await writeFile(join(testDir, "SKILL.md"), original);

		const result = await scaffoldSkill({
			agents: ["claude"],
			targetDir: testDir,
		});

		const content = await readFile(join(testDir, "SKILL.md"), "utf-8");
		expect(content).toBe(original);
		expect(result.skipped).toContain("SKILL.md");
		expect(result.created).not.toContain("SKILL.md");
	});

	it("skips both files when both exist", async () => {
		await writeFile(join(testDir, "agntc.json"), "{}");
		await writeFile(join(testDir, "SKILL.md"), "# Existing");

		const result = await scaffoldSkill({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.created).toEqual([]);
		expect(result.skipped).toEqual(["agntc.json", "SKILL.md"]);
	});

	it("reports created files correctly", async () => {
		const result = await scaffoldSkill({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.created).toEqual(["agntc.json", "SKILL.md"]);
		expect(result.skipped).toEqual([]);
	});

	it("agntc.json has trailing newline", async () => {
		await scaffoldSkill({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content.endsWith("\n")).toBe(true);
	});
});
