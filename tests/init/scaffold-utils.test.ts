import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigFile } from "../../src/init/scaffold-utils.js";

describe("writeConfigFile", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-utils-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("returns created status when file does not exist", async () => {
		const result = await writeConfigFile(testDir, ["claude"]);

		expect(result).toEqual({ path: "agntc.json", status: "created" });
	});

	it("writes agntc.json with correct content when created", async () => {
		await writeConfigFile(testDir, ["claude"]);

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("returns skipped status when file exists and reconfigure is undefined", async () => {
		await writeFile(join(testDir, "agntc.json"), "{}");

		const result = await writeConfigFile(testDir, ["claude"]);

		expect(result).toEqual({ path: "agntc.json", status: "skipped" });
	});

	it("returns skipped status when file exists and reconfigure is false", async () => {
		await writeFile(join(testDir, "agntc.json"), "{}");

		const result = await writeConfigFile(testDir, ["claude"], false);

		expect(result).toEqual({ path: "agntc.json", status: "skipped" });
	});

	it("does not modify file when skipped", async () => {
		const original = '{"agents": ["codex"]}\n';
		await writeFile(join(testDir, "agntc.json"), original);

		await writeConfigFile(testDir, ["claude"]);

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe(original);
	});

	it("returns overwritten status when file exists and reconfigure is true", async () => {
		await writeFile(join(testDir, "agntc.json"), "{}");

		const result = await writeConfigFile(testDir, ["claude"], true);

		expect(result).toEqual({ path: "agntc.json", status: "overwritten" });
	});

	it("overwrites file content when reconfigure is true", async () => {
		await writeFile(join(testDir, "agntc.json"), '{"agents": ["codex"]}');

		await writeConfigFile(testDir, ["claude"], true);

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe('{\n  "agents": [\n    "claude"\n  ]\n}\n');
	});

	it("writes both agents when both selected", async () => {
		await writeConfigFile(testDir, ["claude", "codex"]);

		const content = await readFile(join(testDir, "agntc.json"), "utf-8");
		expect(content).toBe(
			'{\n  "agents": [\n    "claude",\n    "codex"\n  ]\n}\n',
		);
	});
});
