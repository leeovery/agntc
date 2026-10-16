import { describe, expect, it } from "vitest";
import {
	addedRow,
	addTally,
	holdings,
	listedRow,
	sourceHead,
	sourceRow,
	sourceSubject,
} from "../src/add-render.js";
import type { SkillNote } from "../src/choose-items.js";
import type { InstallItem } from "../src/install-item.js";
import type { ItemIdentity, ItemOutcome } from "../src/summary.js";

const HEAD = { subject: "owner/repo", meta: "v1.0.0 ^1.0.0" };

function item(label: string, kind: "skill" | "pack" = "skill"): ItemIdentity {
	return { label, key: `owner/repo/${label}`, kind, path: label };
}

function installed(label: string): ItemOutcome {
	return {
		...item(label),
		status: "installed",
		assetCounts: { skills: 1 },
		files: [],
	};
}

function pack(label: string, assetCounts: object): ItemOutcome {
	return {
		...item(label, "pack"),
		status: "installed",
		assetCounts,
		files: [],
	};
}

function note(path: string, detail: string, leftOut: boolean): SkillNote {
	const text = `${path} is ${detail}`;
	return { subject: path, detail, text, plain: text, path, leftOut };
}

const skillItem = (path: string): InstallItem => ({
	kind: "skill",
	skill: { name: path, path },
});
const packItem = (path: string): InstallItem => ({
	kind: "pack",
	pack: { name: path, path, skills: [], supportFolders: [], assetDirs: [] },
});

describe("sourceHead", () => {
	it("names the source, its ref and its constraint after it", () => {
		expect(
			sourceHead("owner/repo", {
				ref: "v1.0.0",
				commit: "abc",
				constraint: "^1.0.0",
			}),
		).toEqual(HEAD);
	});

	it("says HEAD for a remote source with no ref, and local for a local one", () => {
		expect(sourceHead("owner/repo", { ref: null, commit: "abc" }).meta).toBe(
			"HEAD",
		);
		expect(sourceHead("~/skills", { ref: null, commit: null }).meta).toBe(
			"local",
		);
	});
});

describe("holdings", () => {
	it("counts packs, then skills", () => {
		expect(
			holdings([packItem("p"), packItem("q"), skillItem("a"), skillItem("b")]),
		).toBe("2 packs · 2 skills");
		expect(holdings([packItem("p"), skillItem("a")])).toBe("1 pack · 1 skill");
	});

	it("leaves out a count of none", () => {
		expect(holdings([skillItem("a")])).toBe("1 skill");
		expect(holdings([packItem("p")])).toBe("1 pack");
	});

	it("says so when there's nothing", () => {
		expect(holdings([])).toBe("no skills or packs");
	});
});

describe("sourceSubject", () => {
	it("gives each of several names a glyph's room, as children that end differently carry one", () => {
		expect(sourceSubject(HEAD, ["a", "b", "a"])).toEqual({
			...HEAD,
			children: [
				{ name: "a", status: "done" },
				{ name: "b", status: "done" },
			],
		});
	});

	it("gives a lone name none, as one child never carries a glyph", () => {
		expect(sourceSubject(HEAD, ["a", "a"])).toEqual({
			...HEAD,
			children: [{ name: "a" }],
		});
	});
});

describe("sourceRow", () => {
	it("says what the source holds, with the skills left off the menu beneath it", () => {
		expect(
			sourceRow(HEAD, "2 skills", [
				note("tools/api", "already installed as part of the pack p", true),
			]),
		).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
			children: [
				{
					name: "tools/api",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});

	it("has no children when none is left off", () => {
		expect(sourceRow(HEAD, "2 skills", [])).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
		});
	});
});

describe("listedRow", () => {
	it("hangs every item offered beneath the source, with its hint", () => {
		expect(
			listedRow(HEAD, "1 pack · 1 skill", [
				{ value: packItem("p"), label: "p", hint: "pack · 1 skill" },
				{ value: skillItem("a"), label: "a" },
			]),
		).toEqual({
			status: "done",
			...HEAD,
			detail: "1 pack · 1 skill",
			children: [{ name: "p", detail: "pack · 1 skill" }, { name: "a" }],
		});
	});
});

describe("addedRow", () => {
	it("hangs each item installed beneath the source, with its kind, none with a glyph", () => {
		expect(
			addedRow(HEAD, "2 skills", [installed("a"), installed("b")], []),
		).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
			children: [
				{ name: "a", detail: "skill" },
				{ name: "b", detail: "skill" },
			],
		});
	});

	it.each([
		[{ skills: 12, agents: 3, hooks: 1 }, "pack · 12 skills, 3 agents, 1 hook"],
		[{ skills: 0, agents: 2 }, "pack · 0 skills, 2 agents"],
		[
			{ skills: 23, folders: 3, agents: 1 },
			"pack · 23 skills, 3 folders, 1 agent",
		],
	])("counts a pack's assets, skills always first: %o", (counts, detail) => {
		expect(addedRow(HEAD, "1 pack", [pack("p", counts)], []).children).toEqual([
			{ name: "p", detail },
		]);
	});

	it("marks each child by how it ended when they ended apart, the row by the worst", () => {
		const row = addedRow(
			HEAD,
			"3 skills",
			[
				installed("a"),
				{ ...item("b"), status: "skipped", reason: "conflict not resolved" },
				{ ...item("c"), status: "failed", reason: "disk full" },
			],
			[],
		);

		expect(row.status).toBe("failed");
		expect(row.children).toEqual([
			{ name: "a", status: "done", detail: "skill" },
			{ name: "b", status: "attention", detail: "conflict not resolved" },
			{ name: "c", status: "failed", detail: "disk full" },
		]);
	});

	it("reads a skipped item as needing a look", () => {
		expect(
			addedRow(
				HEAD,
				"1 skill",
				[{ ...item("a"), status: "skipped", reason: "conflict not resolved" }],
				[],
			).status,
		).toBe("attention");
	});

	it("words a failure carrying a message by its text, its remedy apart", () => {
		const row = addedRow(
			HEAD,
			"1 skill",
			[
				{
					...item("a"),
					status: "failed",
					reason: "owner/repo/a is held; to replace it: npx agntc remove …",
					message: {
						subject: "owner/repo/a",
						detail: "is held",
						text: "owner/repo/a is held",
						plain: "owner/repo/a is held; to replace it: npx agntc remove …",
					},
				},
			],
			[],
		);

		expect(row.children).toEqual([
			{ name: "a", detail: "owner/repo/a is held" },
		]);
	});

	it("carries a skill's note from its pack under its kind", () => {
		const row = addedRow(
			HEAD,
			"1 pack",
			[installed("p/skills/a")],
			[note("p/skills/a", "part of the pack p — installed on its own", false)],
		);

		expect(row.children).toEqual([
			{
				name: "p/skills/a",
				detail: "skill\npart of the pack p — installed on its own",
			},
		]);
	});

	it("hangs the skills left out after what installed, as notes", () => {
		const row = addedRow(
			HEAD,
			"2 skills",
			[installed("tools/lint")],
			[note("tools/api", "already installed as part of the pack p", true)],
		);

		expect(row.status).toBe("done");
		expect(row.children).toEqual([
			{ name: "tools/lint", status: "done", detail: "skill" },
			{
				name: "tools/api",
				status: "note",
				detail: "already installed as part of the pack p",
			},
		]);
	});

	it("has nothing to do when everything was left out", () => {
		const row = addedRow(
			HEAD,
			"1 skill",
			[],
			[note("tools/api", "already installed as part of the pack p", true)],
		);

		expect(row).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "1 skill",
			children: [
				{
					name: "tools/api",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});
});

describe("addTally", () => {
	it("counts each outcome by add's category", () => {
		expect(
			addTally([
				installed("a"),
				installed("b"),
				{ ...item("c"), status: "skipped", reason: "x" },
				{ ...item("d"), status: "failed", reason: "y" },
			]),
		).toEqual({ installed: 2, skipped: 1, failed: 1 });
	});

	it("counts nothing for no outcome", () => {
		expect(addTally([])).toEqual({});
	});
});
