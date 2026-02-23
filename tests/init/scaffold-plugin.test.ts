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
import { scaffoldPlugin } from "../../src/init/scaffold-plugin.js";

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

describe("scaffoldPlugin", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-plugin-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("creates all four items in empty directory", async () => {
		await scaffoldPlugin({ agents: ["claude"], targetDir: testDir });

		expect(await exists(join(testDir, "agntc.json"))).toBe(true);
		expect(await exists(join(testDir, "skills", "my-skill", "SKILL.md"))).toBe(
			true,
		);
		expect(await exists(join(testDir, "agents"))).toBe(true);
		expect(await exists(join(testDir, "hooks"))).toBe(true);
	});

	it("writes agntc.json with selected agents", async () => {
		await scaffoldPlugin({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("writes SKILL.md with spec template", async () => {
		await scaffoldPlugin({ agents: ["claude"], targetDir: testDir });

		const content = await readFile(
			join(testDir, "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(SKILL_MD_TEMPLATE);
	});

	it("skips agntc.json when it already exists", async () => {
		const original = '{"agents": ["codex"]}\n';
		await writeFile(join(testDir, "agntc.json"), original);

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe(original);
		expect(result.skipped).toContain("agntc.json");
		expect(result.created).not.toContain("agntc.json");
	});

	it("skips SKILL.md when it already exists inside skills/my-skill/", async () => {
		const original = "# Existing skill\n";
		await mkdir(join(testDir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(testDir, "skills", "my-skill", "SKILL.md"), original);

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		const content = await readFile(
			join(testDir, "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(original);
		expect(result.skipped).toContain("skills/my-skill/SKILL.md");
		expect(result.created).not.toContain("skills/my-skill/SKILL.md");
	});

	it("creates SKILL.md when skills/ exists but SKILL.md does not", async () => {
		await mkdir(join(testDir, "skills"), { recursive: true });

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(await exists(join(testDir, "skills", "my-skill", "SKILL.md"))).toBe(
			true,
		);
		expect(result.created).toContain("skills/my-skill/SKILL.md");
	});

	it("skips agents/ when it already exists", async () => {
		await mkdir(join(testDir, "agents"), { recursive: true });

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.skipped).toContain("agents/");
		expect(result.created).not.toContain("agents/");
	});

	it("skips hooks/ when it already exists", async () => {
		await mkdir(join(testDir, "hooks"), { recursive: true });

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.skipped).toContain("hooks/");
		expect(result.created).not.toContain("hooks/");
	});

	it("created and skipped arrays account for all four items", async () => {
		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		const allItems = [...result.created, ...result.skipped];
		expect(allItems).toHaveLength(4);
		expect(allItems).toContain("agntc.json");
		expect(allItems).toContain("skills/my-skill/SKILL.md");
		expect(allItems).toContain("agents/");
		expect(allItems).toContain("hooks/");
	});

	it("fresh mode returns empty overwritten array", async () => {
		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
		});

		expect(result.overwritten).toEqual([]);
	});

	it("scaffoldPlugin overwrites agntc.json when reconfigure is true", async () => {
		const original = '{"agents": ["codex"]}\n';
		await writeFile(join(testDir, "agntc.json"), original);

		await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("scaffoldPlugin skips SKILL.md even in reconfigure mode", async () => {
		const original = "# Existing skill\n";
		await writeFile(join(testDir, "agntc.json"), "{}");
		await mkdir(join(testDir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(testDir, "skills", "my-skill", "SKILL.md"), original);

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		const content = await readFile(
			join(testDir, "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);
		expect(content).toBe(original);
		expect(result.skipped).toContain("skills/my-skill/SKILL.md");
	});

	it("scaffoldPlugin reports agntc.json as overwritten", async () => {
		await writeFile(join(testDir, "agntc.json"), "{}");

		const result = await scaffoldPlugin({
			agents: ["claude"],
			targetDir: testDir,
			reconfigure: true,
		});

		expect(result.overwritten).toContain("agntc.json");
		expect(result.created).not.toContain("agntc.json");
		expect(result.skipped).not.toContain("agntc.json");
	});
});
