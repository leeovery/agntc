import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assetSummary,
	countAssets,
	kindAndCounts,
} from "../src/entry-assets.js";
import type { ManifestEntry } from "../src/manifest.js";
import { makeEntry } from "./helpers/factories.js";

let installRoot: string;
let assets: string;

/** Writes empty files under the install root. */
async function installedFiles(...paths: string[]): Promise<void> {
	for (const path of paths) {
		const full = join(installRoot, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, "");
	}
}

/** What the entry installs, counted under `root` and worded. */
async function summaryOf(entry: ManifestEntry, root: string): Promise<string> {
	return assetSummary(entry, await countAssets(entry, root));
}

beforeEach(async () => {
	installRoot = await mkdtemp(join(tmpdir(), "agntc-entry-assets-"));
});

afterEach(async () => {
	await rm(installRoot, { recursive: true, force: true });
});

describe("assetSummary", () => {
	it("displays asset counts on one line", async () => {
		await installedFiles(
			".claude/skills/a/SKILL.md",
			".claude/skills/b/SKILL.md",
		);

		assets = await summaryOf(
			makeEntry({ files: [".claude/skills/a/", ".claude/skills/b/"] }),
			installRoot,
		);

		expect(assets).toBe("2 skills");
	});

	it("counts a skill folder once, however many of its paths are recorded", async () => {
		await installedFiles(".claude/skills/a/SKILL.md");

		assets = await summaryOf(
			makeEntry({
				files: [
					".claude/skills/a/",
					".claude/skills/a/SKILL.md",
					".claude/skills/a/refs/guide.md",
				],
			}),
			installRoot,
		);

		expect(assets).toBe("1 skill");
	});

	it("displays mixed asset types", async () => {
		await installedFiles(
			".claude/skills/a/SKILL.md",
			".claude/skills/b/SKILL.md",
		);

		assets = await summaryOf(
			makeEntry({
				files: [
					".claude/skills/a/",
					".claude/skills/b/",
					".claude/hooks/pre-commit.sh",
				],
			}),
			installRoot,
		);

		expect(assets).toBe("2 skills, 1 hook");
	});

	it("counts a pack's installed folders without a SKILL.md as support folders, worded as add words them", async () => {
		await installedFiles(
			".claude/skills/a/SKILL.md",
			".claude/skills/b/SKILL.md",
			".claude/skills/shared/references/x.md",
			".claude/skills/gates/.claude-plugin/plugin.json",
			".claude/skills/rows/hooks/hooks.json",
		);

		assets = await summaryOf(
			makeEntry({
				type: "pack",
				files: [
					".claude/skills/a/",
					".claude/skills/b/",
					".claude/skills/gates/",
					".claude/skills/rows/",
					".claude/skills/shared/",
					".claude/agents/x.md",
				],
			}),
			installRoot,
		);

		expect(assets).toBe("2 skills, 3 folders, 1 agent");
	});

	it("gives a pack's skill count even when it holds only support folders", async () => {
		await installedFiles(".claude/skills/shared/references/x.md");

		assets = await summaryOf(
			makeEntry({ type: "pack", files: [".claude/skills/shared/"] }),
			installRoot,
		);

		expect(assets).toBe("0 skills, 1 folder");
	});

	it("never counts a loose file v1 recorded in .claude/skills as a folder", async () => {
		await installedFiles(
			".claude/skills/a/SKILL.md",
			".claude/skills/README.md",
		);

		assets = await summaryOf(
			makeEntry({
				type: "pack",
				files: [".claude/skills/README.md", ".claude/skills/a/"],
			}),
			installRoot,
		);

		expect(assets).toBe("1 skill");
	});

	it("counts agent files", async () => {
		assets = await summaryOf(
			makeEntry({
				files: [".claude/agents/agent-a.md"],
			}),
			installRoot,
		);

		expect(assets).toBe("1 agent");
	});

	it("counts a skill entry's folder as a skill without looking at what the install holds", async () => {
		await installedFiles(".claude/skills/a/notes.md");

		assets = await summaryOf(
			makeEntry({ type: "skill", files: [".claude/skills/a/"] }),
			installRoot,
		);

		expect(assets).toBe("1 skill");
	});

	it("counts a pack's folder as a skill when its SKILL.md is a link or the folder can't be read", async () => {
		await installedFiles(
			".claude/skills/linked/notes.md",
			".claude/skills/locked/SKILL.md",
			"elsewhere/SKILL.md",
		);
		await symlink(
			join(installRoot, "elsewhere/SKILL.md"),
			join(installRoot, ".claude/skills/linked/SKILL.md"),
		);
		const locked = join(installRoot, ".claude/skills/locked");
		await chmod(locked, 0o000);

		try {
			assets = await summaryOf(
				makeEntry({
					type: "pack",
					files: [".claude/skills/linked/", ".claude/skills/locked/"],
				}),
				installRoot,
			);
		} finally {
			await chmod(locked, 0o755);
		}

		expect(assets).toBe("2 skills");
	});

	it("counts each top-level hook entry once, however many of its paths are recorded", async () => {
		await installedFiles(".claude/skills/a/SKILL.md");

		assets = await summaryOf(
			makeEntry({
				type: "pack",
				files: [
					".claude/skills/a/",
					".claude/hooks/lint/",
					".claude/hooks/lint/run.sh",
					".claude/hooks/lint/lib/util.sh",
					".claude/hooks/pre-commit.sh",
				],
			}),
			installRoot,
		);

		expect(assets).toBe("1 skill, 2 hooks");
	});

	it("counts a v1 entry's agents and hooks as add does, leaving out the folders it recorded", async () => {
		await installedFiles(".claude/skills/a/SKILL.md");

		assets = await summaryOf(
			makeEntry({
				type: "pack",
				files: [
					".claude/skills/a/",
					".claude/agents/",
					".claude/agents/team/",
					".claude/agents/team/lead.md",
					".claude/agents/reviewer.md",
					".claude/hooks/",
					".claude/hooks/pre-commit.sh",
				],
			}),
			installRoot,
		);

		expect(assets).toBe("1 skill, 2 agents, 1 hook");
	});

	it("words a legacy pack recording nothing in .claude/ by what it has, with no skill count", async () => {
		assets = await summaryOf(
			makeEntry({
				type: "pack",
				files: [".agents/skills/a/", ".agents/skills/b/", ".cursor/skills/a/"],
			}),
			installRoot,
		);

		expect(assets).toBe("3 other");
	});

	it("is empty for an entry recording no files", async () => {
		expect(await summaryOf(makeEntry({ files: [] }), installRoot)).toBe("");
	});
});

describe("kindAndCounts", () => {
	it("gives a pack's counts after its kind", () => {
		expect(
			kindAndCounts(makeEntry({ type: "pack" }), "2 skills, 1 agent"),
		).toBe("pack · 2 skills, 1 agent");
	});

	it("gives a skill, or an entry with no type, as its kind alone", () => {
		expect(kindAndCounts(makeEntry({ type: "skill" }), "1 skill")).toBe(
			"skill",
		);
		expect(kindAndCounts(makeEntry(), "1 skill")).toBe("skill");
	});

	it("gives a pack recording nothing as its kind alone", () => {
		expect(kindAndCounts(makeEntry({ type: "pack" }), "")).toBe("pack");
	});
});
