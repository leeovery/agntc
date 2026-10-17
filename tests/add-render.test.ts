import { describe, expect, it } from "vitest";
import {
	addedRow,
	addTally,
	askedRow,
	clearedWords,
	holdings,
	listedRow,
	pickedDetail,
	sourceHead,
	sourceSubject,
	stoppedRow,
} from "../src/add-render.js";
import type { SkillNote } from "../src/choose-items.js";
import type { InstallItem } from "../src/install-item.js";
import type { ItemIdentity, ItemOutcome } from "../src/summary.js";

const HEAD = { subject: "owner/repo", meta: "v1.0.0 ^1.0.0" };
const HOME = "/home/lee";
/** Why an item stops when its question is answered no: whose files are in its way. */
const DECLINED = "files in the way belong to other/repo: .claude/skills/b/";

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

/** A skill taken from its pack to install on its own. */
function taken(path: string, detail: string): SkillNote {
	const text = `${path} is ${detail}`;
	return { subject: path, detail, text, plain: text, path };
}

/** A skill left out, as the installed pack `pack` holds it. */
function held(path: string, pack = "p"): SkillNote {
	return {
		...taken(path, `already installed as part of the pack ${pack}`),
		heldBy: pack,
	};
}

function failed(label: string, reason: string): ItemOutcome {
	return { ...item(label), status: "failed", reason };
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

describe("pickedDetail", () => {
	it("counts what installed of what the menu offered", () => {
		expect(
			pickedDetail(
				[installed("a"), failed("b", "disk full"), installed("c")],
				5,
			),
		).toBe("2 of 5 installed");
	});
});

describe("sourceSubject", () => {
	it("gives each of several items a glyph's room, as items that end differently carry one", () => {
		expect(sourceSubject(HEAD, ["a", "b", "a"], [])).toEqual({
			...HEAD,
			children: [
				{ name: "a", status: "done" },
				{ name: "b", status: "done" },
			],
		});
	});

	it("gives a lone item none, as one item never carries a glyph", () => {
		expect(sourceSubject(HEAD, ["a", "a"], [])).toEqual({
			...HEAD,
			children: [{ name: "a" }],
		});
	});

	it("gives every note a glyph's room, and measures the line a question's row counts them on", () => {
		expect(
			sourceSubject(HEAD, ["a"], [held("tools/api"), held("tools/db")]),
		).toEqual({
			...HEAD,
			children: [
				{ name: "a" },
				{ name: "tools/api", status: "note" },
				{ name: "tools/db", status: "note" },
				{ name: "2 skills", status: "note" },
			],
		});
	});
});

describe("askedRow", () => {
	it("says what the source holds, with a skill left off the menu beneath it, by name", () => {
		expect(askedRow(HEAD, "2 skills", [held("tools/api")])).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
			children: [
				{
					name: "tools/api",
					status: "note",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});

	it("counts the skills one installed pack holds on one line, each pack its own", () => {
		expect(
			askedRow(HEAD, "5 skills", [
				held("tools/api", "p"),
				held("tools/db", "p"),
				held("tools/ui", "p"),
				held("x/lint", "q"),
			]).children,
		).toEqual([
			{
				name: "3 skills",
				status: "note",
				detail: "already installed as part of the pack p",
			},
			{
				name: "x/lint",
				status: "note",
				detail: "already installed as part of the pack q",
			},
		]);
	});

	it("has no children when none is left off", () => {
		expect(askedRow(HEAD, "2 skills", [])).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
		});
	});
});

describe("stoppedRow", () => {
	it("leaves the source unchanged, with every skill left out in full", () => {
		expect(
			stoppedRow(
				HEAD,
				"3 skills",
				[held("tools/api"), held("tools/db")],
				"unchanged",
			),
		).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "3 skills",
			children: [
				{
					name: "tools/api",
					status: "note",
					detail: "already installed as part of the pack p",
				},
				{
					name: "tools/db",
					status: "note",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});

	it("has no children when the choice left nothing out, a taken skill's note told only under it once installed", () => {
		expect(
			stoppedRow(
				HEAD,
				"2 skills",
				[taken("p/skills/a", "part of the pack p — installed on its own")],
				"unchanged",
			),
		).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "2 skills",
		});
	});

	it("fails the source once a stop may have left files on disk", () => {
		expect(
			stoppedRow(HEAD, "2 skills", [held("tools/api")], "failed"),
		).toMatchObject({ status: "failed", children: [{ name: "tools/api" }] });
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
			addedRow(HEAD, "2 skills", [installed("a"), installed("b")], [], HOME),
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
		expect(
			addedRow(HEAD, "1 pack", [pack("p", counts)], [], HOME).children,
		).toEqual([{ name: "p", detail }]);
	});

	it("marks each child by how it ended when they ended apart, the row by the worst", () => {
		const row = addedRow(
			HEAD,
			"3 skills",
			[
				installed("a"),
				{ ...item("b"), status: "skipped", reason: DECLINED },
				failed("c", "disk full"),
			],
			[],
			HOME,
		);

		expect(row.status).toBe("failed");
		expect(row.children).toEqual([
			{ name: "a", status: "done", detail: "skill" },
			{ name: "b", status: "attention", detail: DECLINED },
			{ name: "c", status: "failed", detail: "disk full" },
		]);
	});

	it("says under each item's kind or reason what was cleared out of its way, a line each", () => {
		const row = addedRow(
			HEAD,
			"2 skills",
			[
				{
					...installed("a"),
					cleared: [
						{ kind: "entry", key: "other/repo", files: [".claude/skills/a/"] },
						{ kind: "unmanaged", files: [".claude/agents/x.md"] },
					],
				},
				{
					...item("b"),
					status: "skipped",
					reason: "files in the way belong to other/two: .claude/skills/b/",
					cleared: [
						{ kind: "entry", key: "other/one", files: [".claude/skills/c/"] },
					],
				},
			],
			[],
			HOME,
		);

		expect(row.children).toEqual([
			{
				name: "a",
				status: "done",
				detail: [
					"skill",
					"removed other/repo, whose files were in the way: a",
					"replaced files agntc didn't install: x.md",
				].join("\n"),
			},
			{
				name: "b",
				status: "attention",
				detail: [
					"files in the way belong to other/two: .claude/skills/b/",
					"removed other/one, whose files were in the way: c",
				].join("\n"),
			},
		]);
	});

	it("reads a skipped item as needing a look", () => {
		expect(
			addedRow(
				HEAD,
				"1 skill",
				[{ ...item("a"), status: "skipped", reason: DECLINED }],
				[],
				HOME,
			).status,
		).toBe("attention");
	});

	it("words a failure carrying a message by its detail, as the row names the item", () => {
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
						detail: "held",
						text: "owner/repo/a is held",
						plain: "owner/repo/a is held; to replace it: npx agntc remove …",
					},
				},
			],
			[],
			HOME,
		);

		expect(row.children).toEqual([{ name: "a", detail: "held" }]);
	});

	it("carries a skill's note from its pack under its kind", () => {
		const row = addedRow(
			HEAD,
			"1 pack",
			[installed("p/skills/a")],
			[taken("p/skills/a", "part of the pack p — installed on its own")],
			HOME,
		);

		expect(row.children).toEqual([
			{
				name: "p/skills/a",
				detail: "skill\npart of the pack p — installed on its own",
			},
		]);
	});

	it("carries a taken skill's note only when it installed", () => {
		const row = addedRow(
			HEAD,
			"1 pack",
			[failed("p/skills/a", "disk full")],
			[taken("p/skills/a", "part of the pack p — installed on its own")],
			HOME,
		);

		expect(row.children).toEqual([{ name: "p/skills/a", detail: "disk full" }]);
	});

	it("hangs the skills left out after what installed, each in full with its glyph, the outcomes alike with none", () => {
		const row = addedRow(
			HEAD,
			"2 skills",
			[installed("tools/lint")],
			[held("tools/api"), held("tools/db")],
			HOME,
		);

		expect(row.status).toBe("done");
		expect(row.children).toEqual([
			{ name: "tools/lint", detail: "skill" },
			{
				name: "tools/api",
				status: "note",
				detail: "already installed as part of the pack p",
			},
			{
				name: "tools/db",
				status: "note",
				detail: "already installed as part of the pack p",
			},
		]);
	});

	it("has nothing to do when everything was left out", () => {
		const row = addedRow(HEAD, "1 skill", [], [held("tools/api")], HOME);

		expect(row).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "1 skill",
			children: [
				{
					name: "tools/api",
					status: "note",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});
});

describe("clearedWords", () => {
	it("names another entry removed, and its files that were in the way", () => {
		expect(
			clearedWords(
				{
					kind: "entry",
					key: "other/repo",
					files: [".claude/skills/a/", ".claude/agents/x.md"],
				},
				HOME,
			),
		).toBe("removed other/repo, whose files were in the way: a and x.md");
	});

	it("names a local entry removed as its row named it, shortened against the home folder", () => {
		expect(
			clearedWords(
				{
					kind: "entry",
					key: `${HOME}/src/kit/a`,
					files: [".claude/skills/a/"],
				},
				HOME,
			),
		).toBe("removed ~/src/kit/a, whose files were in the way: a");
	});

	it("names files agntc didn't install, replaced", () => {
		expect(
			clearedWords({ kind: "unmanaged", files: [".claude/skills/a/"] }, HOME),
		).toBe("replaced files agntc didn't install: a");
	});

	it("names a skill folder once, by its folder, and any other path by its last segment", () => {
		expect(
			clearedWords(
				{
					kind: "unmanaged",
					files: [
						".claude/skills/nuxt-data/",
						".claude/skills/nuxt-data/SKILL.md",
						".claude/hooks/lint/",
					],
				},
				HOME,
			),
		).toBe("replaced files agntc didn't install: nuxt-data and lint");
	});

	it("names a few, then counts the rest", () => {
		const names = ["nuxt-data", "nuxt-i18n", "nuxt-seo", "nuxt-a", "nuxt-b"];
		expect(
			clearedWords(
				{
					kind: "entry",
					key: `${HOME}/src/kit/a`,
					files: names.map((name) => `.claude/skills/${name}/`),
				},
				HOME,
			),
		).toBe(
			"removed ~/src/kit/a, whose files were in the way: nuxt-data, nuxt-i18n, nuxt-seo and 2 more",
		);
		expect(
			clearedWords(
				{
					kind: "unmanaged",
					files: names.slice(0, 3).map((name) => `.claude/skills/${name}/`),
				},
				HOME,
			),
		).toBe(
			"replaced files agntc didn't install: nuxt-data, nuxt-i18n and nuxt-seo",
		);
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
