import { describe, expect, it } from "vitest";
import type { EntryAssets } from "../src/entry-assets.js";
import {
	installedFolders,
	type RemovedAssets,
	removalQuestion,
	removalRow,
	removedRow,
	removeFailedRow,
} from "../src/remove-render.js";
import { makeEntry } from "./helpers/factories.js";

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
	const removing = (
		type: "skill" | "pack" | undefined,
		counts: EntryAssets["counts"],
		other = 0,
		files = [".claude/skills/x/"],
	): RemovedAssets => ({
		entry: makeEntry({ files, ...(type === undefined ? {} : { type }) }),
		assets: { counts, other },
	});
	const PACK = removing("pack", { skills: 2, folders: 1, agents: 1, hooks: 1 });
	const SKILL = removing("skill", { skills: 1 });

	it("asks about one entry as it, counting what it installs as its row words it", () => {
		expect(removalQuestion([PACK])).toBe(
			"Remove it and its 2 skills, 1 folder, 1 agent and 1 hook?",
		);
	});

	it("words a lone one by its noun alone", () => {
		expect(removalQuestion([SKILL])).toBe("Remove it and its skill?");
		expect(removalQuestion([removing("pack", { skills: 0, agents: 1 })])).toBe(
			"Remove it and its agent?",
		);
	});

	it("leaves out what it counts none of, a pack's skills included", () => {
		expect(removalQuestion([removing("pack", { skills: 0, folders: 2 })])).toBe(
			"Remove it and its 2 folders?",
		);
	});

	it("asks about several entries as them, adding up what they install in the order a row words it", () => {
		expect(
			removalQuestion([removing("pack", { skills: 0, hooks: 1 }), PACK, SKILL]),
		).toBe("Remove them and their 3 skills, 1 folder, 1 agent and 2 hooks?");
		expect(removalQuestion([SKILL, SKILL])).toBe(
			"Remove them and their 2 skills?",
		);
	});

	it("counts a skill entry as its one skill, whatever its paths, as its row names it", () => {
		const legacy = removing(undefined, { skills: 0 }, 2, [
			".agents/skills/go/",
			".cursor/skills/go/",
		]);
		expect(removalQuestion([legacy])).toBe("Remove it and its skill?");
		expect(
			removalQuestion([removing("skill", { skills: 1, agents: 1 }, 1)]),
		).toBe("Remove it and its skill?");
	});

	it("counts what a legacy pack records outside .claude/ as other items", () => {
		expect(removalQuestion([removing("pack", { skills: 0 }, 3)])).toBe(
			"Remove it and its 3 other items?",
		);
		expect(removalQuestion([removing("pack", { skills: 1 }, 1)])).toBe(
			"Remove it and its 1 skill and 1 other item?",
		);
	});

	it("asks only about the entry when it records nothing", () => {
		const none = removing("skill", {}, 0, []);
		expect(removalQuestion([none])).toBe("Remove it?");
		expect(removalQuestion([none, removing("pack", {}, 0, [])])).toBe(
			"Remove them?",
		);
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
