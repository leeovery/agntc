import { describe, expect, it } from "vitest";
import {
	addedRow,
	addTally,
	askedRow,
	clearedWords,
	holdings,
	itemNames,
	listedRow,
	offerChoices,
	packKind,
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

function item(path: string, kind: "skill" | "pack" = "skill"): ItemIdentity {
	return { key: `owner/repo/${path}`, kind, path };
}

/** The source's name, as a row names its root. */
const ROOT = "repo";

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
		expect(sourceSubject(HEAD, ["a", "b", "a"], [], ROOT)).toEqual({
			...HEAD,
			children: [
				{ name: "a", status: "done" },
				{ name: "b", status: "done" },
			],
		});
	});

	it("measures each item and note by its name alone, as an aside never widens a column", () => {
		expect(
			sourceSubject(HEAD, ["x/a", "y/a"], [held("tools/a")], "repo"),
		).toEqual({
			...HEAD,
			children: [
				{ name: "a", status: "done" },
				{ name: "a", status: "done" },
				{ name: "a", status: "note" },
			],
		});
	});

	it("gives a lone item none, as one item never carries a glyph", () => {
		expect(sourceSubject(HEAD, ["a", "a"], [], ROOT)).toEqual({
			...HEAD,
			children: [{ name: "a" }],
		});
	});

	it("gives every note a glyph's room, and measures the line a question's row counts them on", () => {
		expect(
			sourceSubject(HEAD, ["a"], [held("tools/api"), held("tools/db")], ROOT),
		).toEqual({
			...HEAD,
			children: [
				{ name: "a" },
				{ name: "api", status: "note" },
				{ name: "db", status: "note" },
				{ name: "2 skills", status: "note" },
			],
		});
	});
});

describe("askedRow", () => {
	it("says what the source holds, with a skill left off the menu beneath it, by name", () => {
		expect(askedRow(HEAD, "2 skills", [held("tools/api")], ROOT)).toEqual({
			status: "done",
			...HEAD,
			detail: "2 skills",
			children: [
				{
					name: "api",
					status: "note",
					detail: "already installed as part of the pack p",
				},
			],
		});
	});

	it("counts the skills one installed pack holds on one line, each pack its own", () => {
		expect(
			askedRow(
				HEAD,
				"5 skills",
				[
					held("tools/api", "p"),
					held("tools/db", "p"),
					held("tools/ui", "p"),
					held("x/lint", "q"),
				],
				ROOT,
			).children,
		).toEqual([
			{
				name: "3 skills",
				status: "note",
				detail: "already installed as part of the pack p",
			},
			{
				name: "lint",
				status: "note",
				detail: "already installed as part of the pack q",
			},
		]);
	});

	it("has no children when none is left off", () => {
		expect(askedRow(HEAD, "2 skills", [], ROOT)).toEqual({
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
				ROOT,
				"unchanged",
			),
		).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "3 skills",
			children: [
				{
					name: "api",
					status: "note",
					detail: "already installed as part of the pack p",
				},
				{
					name: "db",
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
				ROOT,
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
			stoppedRow(HEAD, "2 skills", [held("tools/api")], ROOT, "failed"),
		).toMatchObject({ status: "failed", children: [{ name: "api" }] });
	});
});

describe("listedRow", () => {
	it("hangs every item offered beneath the source, with its aside and its hint", () => {
		expect(
			listedRow(HEAD, "1 pack · 2 skills", [
				{ value: packItem("p"), label: "p", hint: "pack · 1 skill" },
				{ value: skillItem("a"), label: "a" },
				{ value: skillItem("x/a"), label: "a", aside: "x" },
			]),
		).toEqual({
			status: "done",
			...HEAD,
			detail: "1 pack · 2 skills",
			children: [
				{ name: "p", detail: "pack · 1 skill" },
				{ name: "a" },
				{ name: "a", aside: "x" },
			],
		});
	});
});

describe("itemNames", () => {
	it("names an item by its folder, the source root by the source's name", () => {
		const names = itemNames(["skills/go", ""], "repo");
		expect(names("skills/go")).toEqual({ name: "go" });
		expect(names("")).toEqual({ name: "repo" });
	});

	it("tells items of one name apart by the folder each sits in, a pack's and a skill's alike", () => {
		const names = itemNames(
			["skills/frontend/testing", "skills/backend/testing", "skills/go"],
			"r",
		);
		expect(names("skills/frontend/testing")).toEqual({
			name: "testing",
			aside: "skills/frontend",
		});
		expect(names("skills/backend/testing")).toEqual({
			name: "testing",
			aside: "skills/backend",
		});
		expect(names("skills/go")).toEqual({ name: "go" });
	});

	it("gives no aside to one at the top of the source, or the source itself", () => {
		const names = itemNames(["go", "skills/go", "", "x/repo"], "repo");
		expect(names("go")).toEqual({ name: "go" });
		expect(names("skills/go")).toEqual({ name: "go", aside: "skills" });
		expect(names("")).toEqual({ name: "repo" });
		expect(names("x/repo")).toEqual({ name: "repo", aside: "x" });
	});
});

describe("packKind", () => {
	it("words a pack's kind and every count it installs, skills always first", () => {
		expect(packKind({ skills: 2, folders: 1, agents: 1, hooks: 1 })).toBe(
			"pack · 2 skills, 1 folder, 1 agent, 1 hook",
		);
		expect(packKind({ hooks: 2 })).toBe("pack · 0 skills, 2 hooks");
	});
});

describe("offerChoices", () => {
	it("offers each item by name, then its hint", () => {
		const skill: InstallItem = {
			kind: "skill",
			skill: { name: "go", path: "skills/go" },
		};
		expect(
			offerChoices(
				[
					{ item: packItem("tools/p"), hint: "pack · 2 skills, 1 hook" },
					{ item: skill, hint: "Go" },
					{ item: skillItem("lint") },
				],
				"repo",
			),
		).toEqual([
			{
				value: packItem("tools/p"),
				label: "p",
				hint: "pack · 2 skills, 1 hook",
			},
			{ value: skill, label: "go", hint: "Go" },
			{ value: skillItem("lint"), label: "lint" },
		]);
	});

	it("carries the folder an item sits in as its aside where another offered shares its name", () => {
		expect(
			offerChoices(
				[
					{ item: skillItem("skills/frontend/testing"), hint: "A" },
					{ item: skillItem("skills/backend/testing") },
				],
				"repo",
			),
		).toEqual([
			{
				value: skillItem("skills/frontend/testing"),
				label: "testing",
				aside: "skills/frontend",
				hint: "A",
			},
			{
				value: skillItem("skills/backend/testing"),
				label: "testing",
				aside: "skills/backend",
			},
		]);
	});
});

describe("addedRow", () => {
	it("hangs each item installed beneath the source, with its kind, none with a glyph", () => {
		expect(
			addedRow(
				HEAD,
				"2 skills",
				[installed("a"), installed("b")],
				[],
				ROOT,
				HOME,
			),
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
			addedRow(HEAD, "1 pack", [pack("p", counts)], [], ROOT, HOME).children,
		).toEqual([{ name: "p", detail }]);
	});

	it("names each item and note by its folder, the folder it sits in aside where another the row shows shares the name", () => {
		const row = addedRow(
			HEAD,
			"2 of 3 installed",
			[pack("x/laravel", { skills: 1 }), installed("skills/laravel")],
			[held("tools/go")],
			"r",
			HOME,
		);

		expect(row.children).toEqual([
			{ name: "laravel", aside: "x", detail: "pack · 1 skill" },
			{ name: "laravel", aside: "skills", detail: "skill" },
			{
				name: "go",
				status: "note",
				detail: "already installed as part of the pack p",
			},
		]);
	});

	it("gives an item no aside when nothing else the row shows shares its name", () => {
		expect(
			addedRow(HEAD, "1 skill", [installed("skills/tools")], [], "r", HOME)
				.children,
		).toEqual([{ name: "tools", detail: "skill" }]);
	});

	it("tells notes of one name apart among themselves", () => {
		expect(
			stoppedRow(
				HEAD,
				"2 skills",
				[held("x/api"), held("y/api")],
				"r",
				"unchanged",
			).children,
		).toMatchObject([
			{ name: "api", aside: "x" },
			{ name: "api", aside: "y" },
		]);
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
			ROOT,
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
			ROOT,
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
				ROOT,
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
			ROOT,
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
			ROOT,
			HOME,
		);

		expect(row.children).toEqual([
			{
				name: "a",
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
			ROOT,
			HOME,
		);

		expect(row.children).toEqual([{ name: "a", detail: "disk full" }]);
	});

	it("hangs the skills left out after what installed, each in full with its glyph, the outcomes alike with none", () => {
		const row = addedRow(
			HEAD,
			"2 skills",
			[installed("tools/lint")],
			[held("tools/api"), held("tools/db")],
			ROOT,
			HOME,
		);

		expect(row.status).toBe("done");
		expect(row.children).toEqual([
			{ name: "lint", detail: "skill" },
			{
				name: "api",
				status: "note",
				detail: "already installed as part of the pack p",
			},
			{
				name: "db",
				status: "note",
				detail: "already installed as part of the pack p",
			},
		]);
	});

	it("has nothing to do when everything was left out", () => {
		const row = addedRow(HEAD, "1 skill", [], [held("tools/api")], ROOT, HOME);

		expect(row).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "1 skill",
			children: [
				{
					name: "api",
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
