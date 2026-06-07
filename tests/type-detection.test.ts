import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSET_DIRS, detectType } from "../src/type-detection.js";

let testDir: string;

async function createDir(...segments: string[]): Promise<void> {
	await mkdir(join(testDir, ...segments), { recursive: true });
}

async function createFile(...segments: string[]): Promise<void> {
	const filePath = join(testDir, ...segments);
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, "");
}

describe("ASSET_DIRS", () => {
	it("contains skills, agents, and hooks", () => {
		expect(ASSET_DIRS).toEqual(["skills", "agents", "hooks"]);
	});
});

describe("detectType", () => {
	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "agntc-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("bare-skill", () => {
		it("returns bare-skill from root SKILL.md with no config", async () => {
			await createFile("SKILL.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "bare-skill" });
		});

		it("returns bare-skill with non-asset sibling dirs alongside SKILL.md", async () => {
			await createFile("SKILL.md");
			await createDir("references");
			await createDir("examples");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "bare-skill" });
		});
	});

	describe("plugin", () => {
		it("returns plugin from skills + agents", async () => {
			await createDir("skills");
			await createDir("agents");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "plugin",
				assetDirs: ["skills", "agents"],
			});
		});

		it("returns plugin from agents-only", async () => {
			await createDir("agents");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "plugin", assetDirs: ["agents"] });
		});

		it("returns plugin from hooks-only", async () => {
			await createDir("hooks");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "plugin", assetDirs: ["hooks"] });
		});

		it("returns plugin from agents + hooks", async () => {
			await createDir("agents");
			await createDir("hooks");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "plugin",
				assetDirs: ["agents", "hooks"],
			});
		});

		it("warns and returns plugin when SKILL.md coexists with an asset dir", async () => {
			await createFile("SKILL.md");
			await createDir("agents");
			const onWarn = vi.fn();

			const result = await detectType(testDir, { onWarn });

			expect(result.type).toBe("plugin");
			expect(onWarn).toHaveBeenCalledOnce();
			expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("SKILL.md"));
		});
	});

	describe("skills-only (ambiguous)", () => {
		it("defaults skills-only root to collection", async () => {
			await createDir("skills");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "collection", plugins: [] });
		});
	});

	describe("not-agntc", () => {
		it("returns not-agntc for empty directory", async () => {
			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("returns not-agntc for a root with only loose files", async () => {
			await createFile("readme.txt");
			await createFile("notes.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("returns not-agntc for an unreadable directory without throwing", async () => {
			const unreadable = join(testDir, "locked");
			await mkdir(unreadable);
			await chmod(unreadable, 0o000);

			try {
				const result = await detectType(unreadable, {});
				expect(result).toEqual({ type: "not-agntc" });
			} finally {
				await chmod(unreadable, 0o755);
			}
		});
	});

	describe("config presence ignored", () => {
		it("detects bare-skill identically with or without config", async () => {
			await createFile("SKILL.md");

			const withConfig = await detectType(testDir, { configType: "plugin" });
			const withoutConfig = await detectType(testDir, {});

			expect(withConfig).toEqual({ type: "bare-skill" });
			expect(withoutConfig).toEqual({ type: "bare-skill" });
		});

		it("detects plugin identically with or without config", async () => {
			await createDir("agents");

			const withConfig = await detectType(testDir, { configType: "plugin" });
			const withoutConfig = await detectType(testDir, {});

			expect(withConfig).toEqual({ type: "plugin", assetDirs: ["agents"] });
			expect(withoutConfig).toEqual({ type: "plugin", assetDirs: ["agents"] });
		});
	});
});
