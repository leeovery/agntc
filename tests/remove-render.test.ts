import { describe, expect, it } from "vitest";
import {
	installedFolders,
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

describe("removedRow", () => {
	it("says the entry is removed, in the tally's words, with its kind and counts", () => {
		expect(removedRow("owner/repo/nuxt", "pack · 2 skills")).toEqual({
			status: "done",
			subject: "owner/repo/nuxt",
			detail: { label: "removed", aside: "pack · 2 skills" },
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
