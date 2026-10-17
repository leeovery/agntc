import { describe, expect, it } from "vitest";
import {
	goneRow,
	installedFolders,
	removalQuestion,
	removalRow,
	removedRow,
	removeFailedRow,
} from "../src/remove-render.js";

describe("installedFolders", () => {
	it("names each installed folder once under its asset folder, in the order recorded", () => {
		expect(
			installedFolders([
				".claude/skills/nuxt-pages/",
				".claude/skills/nuxt-pages/SKILL.md",
				".claude/skills/nuxt-pages/refs/guide.md",
				".claude/agents/reviewer.md",
				".claude/skills/shared/",
				".claude/hooks/lint/run.sh",
				".claude/hooks/pre-commit.sh",
			]),
		).toEqual([
			{
				label: ".claude/skills/",
				value: ["nuxt-pages", "shared"],
				noun: "folder",
			},
			{ label: ".claude/agents/", value: ["reviewer.md"], noun: "agent" },
			{
				label: ".claude/hooks/",
				value: ["lint", "pre-commit.sh"],
				noun: "hook",
			},
		]);
	});

	it("names what a legacy entry recorded outside .claude/ under the folders it lies in", () => {
		expect(
			installedFolders([
				".agents/skills/alpha/",
				".cursor/skills/alpha/SKILL.md",
			]),
		).toEqual([
			{ label: ".agents/skills/", value: ["alpha"], noun: "folder" },
			{ label: ".cursor/skills/", value: ["alpha"], noun: "folder" },
		]);
	});

	it("names a path shallower than an asset folder by its last segment, under the folder it's in", () => {
		expect(installedFolders([".claude/agents/", "notes.md"])).toEqual([
			{ label: ".claude/", value: ["agents"] },
			{ label: "", value: ["notes.md"] },
		]);
	});

	it("gives nothing for an entry recording nothing", () => {
		expect(installedFolders([])).toEqual([]);
	});
});

describe("removalRow", () => {
	it("is the subject of the question: the entry, its kind and counts, then what it installed", () => {
		expect(
			removalRow("owner/repo/nuxt", "pack · 1 skill, 1 agent", [
				".claude/skills/nuxt-pages/",
				".claude/agents/reviewer.md",
			]),
		).toEqual({
			status: "subject",
			subject: "owner/repo/nuxt",
			detail: "pack · 1 skill, 1 agent",
			fields: [
				{ label: ".claude/skills/", value: ["nuxt-pages"], noun: "folder" },
				{ label: ".claude/agents/", value: ["reviewer.md"], noun: "agent" },
			],
		});
	});
});

describe("removalQuestion", () => {
	const PACK = [
		".claude/skills/nuxt-pages/",
		".claude/skills/nuxt-pages/SKILL.md",
		".claude/skills/nuxt-data/",
		".claude/agents/reviewer.md",
	];

	it("asks about one entry as it, counting its items by noun as its row names them", () => {
		expect(removalQuestion([PACK])).toBe(
			"Remove it and its 2 folders and 1 agent?",
		);
	});

	it("words a lone item by its noun alone", () => {
		expect(
			removalQuestion([[".claude/skills/go/", ".claude/skills/go/x"]]),
		).toBe("Remove it and its folder?");
		expect(removalQuestion([[".claude/agents/reviewer.md"]])).toBe(
			"Remove it and its agent?",
		);
	});

	it("asks about several entries as them, adding up their items by noun", () => {
		expect(
			removalQuestion([
				PACK,
				[".claude/skills/go/"],
				[".claude/hooks/lint.sh"],
			]),
		).toBe("Remove them and their 3 folders, 1 agent and 1 hook?");
		expect(
			removalQuestion([[".claude/skills/a/"], [".claude/skills/b/"]]),
		).toBe("Remove them and their 2 folders?");
	});

	it("counts an item in a folder with no noun of its own as an item", () => {
		expect(removalQuestion([["notes.md", ".claude/skills/a/"]])).toBe(
			"Remove it and its 1 item and 1 folder?",
		);
	});

	it("asks only about the entry when it records nothing", () => {
		expect(removalQuestion([[]])).toBe("Remove it?");
		expect(removalQuestion([[], []])).toBe("Remove them?");
	});
});

describe("removedRow", () => {
	it("says the entry is removed, in the tally's words, with its kind and counts", () => {
		expect(removedRow("owner/repo/nuxt", "pack · 2 skills")).toEqual({
			status: "done",
			subject: "owner/repo/nuxt",
			detail: { label: "removed", aside: "pack · 2 skills" },
		});
	});

	it("names what the entry installed under each asset folder, given its files", () => {
		expect(
			removedRow("owner/repo/nuxt", "pack · 1 skill, 1 agent", [
				".claude/skills/nuxt-pages/",
				".claude/agents/reviewer.md",
			]),
		).toEqual({
			status: "done",
			subject: "owner/repo/nuxt",
			detail: { label: "removed", aside: "pack · 1 skill, 1 agent" },
			fields: [
				{ label: ".claude/skills/", value: ["nuxt-pages"], noun: "folder" },
				{ label: ".claude/agents/", value: ["reviewer.md"], noun: "agent" },
			],
		});
	});
});

describe("goneRow", () => {
	it("needs a look: the entry, gone upstream with its kind and counts, then what it installed", () => {
		expect(
			goneRow("owner/repo/go", "skill", [
				".claude/skills/go/",
				".claude/skills/go/SKILL.md",
			]),
		).toEqual({
			status: "attention",
			subject: "owner/repo/go",
			detail: { label: "gone upstream", aside: "skill" },
			fields: [{ label: ".claude/skills/", value: ["go"], noun: "folder" }],
		});
	});
});

describe("removeFailedRow", () => {
	it("says the removal failed, why, and that the entry stays recorded", () => {
		expect(
			removeFailedRow("owner/repo/nuxt", "EACCES: permission denied"),
		).toEqual({
			status: "failed",
			subject: "owner/repo/nuxt",
			detail: {
				label: "failed",
				aside: "EACCES: permission denied; it stays recorded",
			},
		});
	});
});
