import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ASSET_DIRS,
	detectType,
	findPresentAssetDirs,
	TypeConflictError,
} from "../src/type-detection.js";

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

describe("findPresentAssetDirs", () => {
	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "agntc-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("returns [] when no asset dirs are present", async () => {
		const result = await findPresentAssetDirs(testDir);

		expect(result).toEqual([]);
	});

	it("returns the single present asset dir", async () => {
		await createDir("agents");

		const result = await findPresentAssetDirs(testDir);

		expect(result).toEqual(["agents"]);
	});

	it("returns multiple present asset dirs in ASSET_DIRS order", async () => {
		// Create out of order; result must follow ASSET_DIRS order.
		await createDir("hooks");
		await createDir("skills");
		await createDir("agents");

		const result = await findPresentAssetDirs(testDir);

		expect(result).toEqual(["skills", "agents", "hooks"]);
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
		it("defaults a populated skills-only root to a collection of the inner skills", async () => {
			// Vercel discoverSkills semantics: walk one level into skills/ and offer
			// each skills/<name>/SKILL.md as an independently-installable member. The
			// member segment carries the dir-relative path (skills/<name>) so the
			// pipeline can both locate the dir and key it by basename.
			await createFile("skills", "a", "SKILL.md");
			await createFile("skills", "b", "SKILL.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "collection",
				plugins: ["skills/a", "skills/b"],
			});
		});

		it("defaults an empty skills-only root to a no-member outcome (no crash)", async () => {
			// Genuinely-empty skills/ has no inner units to enumerate; an empty
			// member list is the existing not-actionable outcome, not a defect.
			await createDir("skills");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "collection", plugins: [] });
		});

		it("ignores a skills/ child that is not itself a unit", async () => {
			// A child of skills/ without SKILL.md (and no asset dir of its own) is not
			// an installable skill, so it is excluded from the enumerated members.
			await createFile("skills", "a", "SKILL.md");
			await createFile("skills", "notes", "readme.txt");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "collection", plugins: ["skills/a"] });
		});
	});

	describe("collection (structural membership, one level down)", () => {
		it("enumerates configless members: child with SKILL.md and child with skills dir", async () => {
			await createFile("alpha", "SKILL.md");
			await createDir("beta", "skills");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "collection",
				plugins: ["alpha", "beta"],
			});
		});

		it("counts a child plugin member by asset dir (agents-only child)", async () => {
			await createDir("tooling", "agents");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "collection", plugins: ["tooling"] });
		});

		it("skips a child with neither SKILL.md nor an asset dir", async () => {
			await createFile("alpha", "SKILL.md");
			await createFile("docs", "readme.txt");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "collection", plugins: ["alpha"] });
		});

		it("enumerates mixed config-bearing and configless members structurally", async () => {
			await createFile("configured", "agntc.json");
			await createDir("configured", "skills");
			await createFile("configless", "SKILL.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "collection",
				plugins: ["configless", "configured"],
			});
		});

		it("does not recurse into a nested-collection child (one level only)", async () => {
			await createFile("outer", "inner-member", "SKILL.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("returns not-agntc when no child qualifies", async () => {
			await createFile("docs", "readme.txt");
			await createFile("notes", "todo.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("no longer treats a child with only agntc.json as a member", async () => {
			await createFile("legacy", "agntc.json");

			const result = await detectType(testDir, {});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("sorts qualifying child names deterministically", async () => {
			await createFile("zeta", "SKILL.md");
			await createFile("alpha", "SKILL.md");
			await createDir("mid", "hooks");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "collection",
				plugins: ["alpha", "mid", "zeta"],
			});
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

	describe("override resolution", () => {
		it("bundles a populated skills-only root as plugin with config type plugin", async () => {
			await createFile("skills", "a", "SKILL.md");
			await createFile("skills", "b", "SKILL.md");

			const result = await detectType(testDir, { configType: "plugin" });

			expect(result).toEqual({ type: "plugin", assetDirs: ["skills"] });
		});

		it("bundles a populated skills-only root as plugin with forcePlugin", async () => {
			await createFile("skills", "a", "SKILL.md");
			await createFile("skills", "b", "SKILL.md");

			const result = await detectType(testDir, { forcePlugin: true });

			expect(result).toEqual({ type: "plugin", assetDirs: ["skills"] });
		});

		it("bundles skills-only as plugin when both overrides agree", async () => {
			await createFile("skills", "a", "SKILL.md");

			const result = await detectType(testDir, {
				configType: "plugin",
				forcePlugin: true,
			});

			expect(result).toEqual({ type: "plugin", assetDirs: ["skills"] });
		});

		it("enumerates inner skills of a skills-only root as collection with no override", async () => {
			await createFile("skills", "a", "SKILL.md");
			await createFile("skills", "b", "SKILL.md");

			const result = await detectType(testDir, {});

			expect(result).toEqual({
				type: "collection",
				plugins: ["skills/a", "skills/b"],
			});
		});

		it("treats forcePlugin as a no-op on a multi-asset plugin", async () => {
			await createDir("skills");
			await createDir("agents");

			const result = await detectType(testDir, { forcePlugin: true });

			expect(result).toEqual({
				type: "plugin",
				assetDirs: ["skills", "agents"],
			});
		});

		it("treats config type plugin as a no-op on a multi-asset plugin", async () => {
			await createDir("skills");
			await createDir("agents");

			const result = await detectType(testDir, { configType: "plugin" });

			expect(result).toEqual({
				type: "plugin",
				assetDirs: ["skills", "agents"],
			});
		});

		it("throws for config type plugin on a bare skill", async () => {
			await createFile("SKILL.md");

			await expect(
				detectType(testDir, { configType: "plugin" }),
			).rejects.toBeInstanceOf(TypeConflictError);
		});

		it("throws for forcePlugin on a bare skill", async () => {
			await createFile("SKILL.md");

			await expect(
				detectType(testDir, { forcePlugin: true }),
			).rejects.toBeInstanceOf(TypeConflictError);
		});

		it("throws for config type plugin on a member-dirs collection", async () => {
			await createFile("alpha", "SKILL.md");
			await createDir("beta", "skills");

			await expect(
				detectType(testDir, { configType: "plugin" }),
			).rejects.toBeInstanceOf(TypeConflictError);
		});

		it("throws for forcePlugin on a member-dirs collection", async () => {
			await createFile("alpha", "SKILL.md");
			await createDir("beta", "skills");

			await expect(
				detectType(testDir, { forcePlugin: true }),
			).rejects.toBeInstanceOf(TypeConflictError);
		});

		it("ignores config type collection on a member-dirs structure", async () => {
			await createFile("alpha", "SKILL.md");
			await createDir("beta", "skills");

			const result = await detectType(testDir, { configType: "collection" });

			expect(result).toEqual({
				type: "collection",
				plugins: ["alpha", "beta"],
			});
		});

		it("ignores an unknown config type on a bare skill", async () => {
			await createFile("SKILL.md");

			const result = await detectType(testDir, { configType: "bundle" });

			expect(result).toEqual({ type: "bare-skill" });
		});

		it("does not throw for not-agntc with overrides", async () => {
			await createFile("readme.txt");

			const result = await detectType(testDir, {
				configType: "plugin",
				forcePlugin: true,
			});

			expect(result).toEqual({ type: "not-agntc" });
		});

		it("names the bare-skill conflict in the error message", async () => {
			await createFile("SKILL.md");

			await expect(detectType(testDir, { forcePlugin: true })).rejects.toThrow(
				/bare skill/,
			);
		});

		it("names the member count in a collection conflict message", async () => {
			await createFile("alpha", "SKILL.md");
			await createDir("beta", "skills");

			await expect(
				detectType(testDir, { configType: "plugin" }),
			).rejects.toThrow(/collection of 2 members/);
		});
	});

	describe("config presence ignored for unambiguous structures", () => {
		it("detects plugin identically with or without config", async () => {
			await createDir("agents");

			const withConfig = await detectType(testDir, { configType: "plugin" });
			const withoutConfig = await detectType(testDir, {});

			expect(withConfig).toEqual({ type: "plugin", assetDirs: ["agents"] });
			expect(withoutConfig).toEqual({ type: "plugin", assetDirs: ["agents"] });
		});
	});
});
