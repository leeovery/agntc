import { describe, expect, it } from "vitest";
import {
	type MultiselectView,
	promptMultiselect,
	renderMultiselect,
} from "../../../src/terminal/prompts/multiselect.js";
import { bandPainter, createStyle } from "../../../src/terminal/style.js";
import type { Choice } from "../../../src/ui.js";
import { KEY, Terminal } from "./terminal.js";

const plain = createStyle(0);
const colour = createStyle(3);
const gap = (columns: number) => " ".repeat(columns);
const HINTS = "↑↓ move · space pick · a all · ⏎ done · esc cancel";
const PICKED = "\x1b[38;2;167;139;250m●\x1b[39m";
const UNPICKED = "\x1b[2m○\x1b[22m";

const OPTIONS: Choice<string>[] = [
	{ value: "laravel", label: "laravel", hint: "pack · 14 skills" },
	{ value: "nuxt", label: "nuxt", hint: "pack · 9 skills, 2 folders" },
	{ value: "python", label: "python", hint: "pack · 11 skills" },
	{
		value: "git-hygiene",
		label: "git-hygiene",
		hint: "Keep commits small and messages honest",
	},
	{
		value: "release-notes",
		label: "release-notes",
		hint: "Draft release notes from the changes since the last tag",
	},
];

function view(
	more: Partial<MultiselectView<string>> = {},
): MultiselectView<string> {
	return {
		message: "What to install",
		hints: HINTS,
		options: OPTIONS,
		cursor: 2,
		top: 0,
		size: 10,
		more: true,
		footer: 2,
		picked: [0, 3],
		warning: "",
		...more,
	};
}

describe("renderMultiselect", () => {
	it.each([
		[80, 11, 66],
		[100, 31, 86],
	])("marks what's picked and counts it at %i", (width, hintGap, countGap) => {
		expect(renderMultiselect(view(), width, plain)).toEqual([
			` ? What to install${gap(hintGap)}${HINTS}`,
			"   ● laravel         pack · 14 skills",
			"   ○ nuxt            pack · 9 skills, 2 folders",
			" ▌ ○ python          pack · 11 skills",
			"   ● git-hygiene     Keep commits small and messages honest",
			"   ○ release-notes   Draft release notes from the changes since the last tag",
			"",
			`${gap(countGap)}2 of 5 picked`,
		]);
	});

	it("cuts a label too wide for its column at its start, its hint kept in the column", () => {
		const root = "/Volumes/Scratch/tmp/claude-501/a-long-session-folder/3a";
		const keys: Choice<string>[] = [
			{ value: "a", label: `${root}/two-skills/alpha`, hint: "skill" },
			{ value: "b", label: `${root}/two-skills/beta`, hint: "skill" },
		];
		expect(
			renderMultiselect(
				view({ options: keys, cursor: 0, picked: [1] }),
				100,
				plain,
			).slice(1, 3),
		).toEqual([
			" ▌ ○ …/a-long-session-folder/3a/two-skills/alpha  skill",
			"   ● …1/a-long-session-folder/3a/two-skills/beta  skill",
		]);
	});

	it("cuts the hints to fit at 40, without the key hints", () => {
		expect(renderMultiselect(view({ cursor: 0 }), 40, plain)).toEqual([
			" ? What to install",
			" ▌ ● laravel         pack · 14 skills",
			"   ○ nuxt            pack · 9 skills, …",
			"   ○ python          pack · 11 skills",
			"   ● git-hygiene     Keep commits smal…",
			"   ○ release-notes   Draft release not…",
			"",
			`${gap(26)}2 of 5 picked`,
		]);
	});

	it("draws the cursor on each option in turn", () => {
		for (const cursor of [0, 1, 2, 3, 4]) {
			const rows = renderMultiselect(view({ cursor }), 80, plain).slice(1, 6);
			expect(rows.map((row) => row.startsWith(" ▌ "))).toEqual(
				[0, 1, 2, 3, 4].map((index) => index === cursor),
			);
		}
	});

	it("counts nothing picked and everything picked", () => {
		expect(renderMultiselect(view({ picked: [] }), 80, plain).at(-1)).toBe(
			`${gap(66)}0 of 5 picked`,
		);
		expect(
			renderMultiselect(view({ picked: [0, 1, 2, 3, 4] }), 80, plain).slice(
				1,
				6,
			),
		).toSatisfy((rows: string[]) => rows.every((row) => row.includes("●")));
	});

	it("warns on the footer's left until something is picked", () => {
		expect(
			renderMultiselect(
				view({ picked: [], warning: "pick at least one" }),
				80,
				plain,
			).at(-1),
		).toBe(`   pick at least one${gap(46)}0 of 5 picked`);
		expect(
			renderMultiselect(
				view({ picked: [], warning: "pick at least one" }),
				40,
				plain,
			).at(-1),
		).toBe(`   pick at least one${gap(6)}0 of 5 picked`);
	});

	it("scrolls a long list as a select does", () => {
		expect(
			renderMultiselect(view({ cursor: 3, top: 2, size: 2 }), 80, plain).slice(
				1,
			),
		).toEqual([
			"   ↑ 2 more",
			"   ○ python          pack · 11 skills",
			" ▌ ● git-hygiene     Keep commits small and messages honest",
			"   ↓ 1 more",
			"",
			`${gap(66)}2 of 5 picked`,
		]);
	});

	it("cuts its more lines to the room the last column leaves", () => {
		const lines = renderMultiselect(
			view({ cursor: 3, top: 2, size: 2 }),
			10,
			plain,
		);
		expect(lines.filter((line) => /[↑↓]/.test(line))).toEqual([
			"   ↑ 2 m…",
			"   ↓ 1 m…",
		]);
	});

	it("leaves out the more lines, and the footer's lines from its first, that its fit has no room for", () => {
		const scrolled = { cursor: 3, top: 3, size: 1, more: false };
		const row = " ▌ ● git-hygiene     Keep commits small and messages honest";
		expect(
			renderMultiselect(view({ ...scrolled, footer: 2 }), 80, plain).slice(1),
		).toEqual([row, "", `${gap(66)}2 of 5 picked`]);
		expect(
			renderMultiselect(view({ ...scrolled, footer: 1 }), 80, plain).slice(1),
		).toEqual([row, `${gap(66)}2 of 5 picked`]);
		expect(
			renderMultiselect(view({ ...scrolled, footer: 0 }), 80, plain).slice(1),
		).toEqual([row]);
	});

	describe("in colour", () => {
		it("marks a pick in the accent and the rest dim", () => {
			const lines = renderMultiselect(view(), 80, colour);
			expect(lines[1]).toBe(
				`   ${PICKED} laravel         \x1b[2mpack · 14 skills\x1b[22m`,
			);
			expect(lines[2]).toBe(
				`   ${UNPICKED} nuxt            \x1b[2mpack · 9 skills, 2 folders\x1b[22m`,
			);
		});

		it("bands the cursor row behind its mark and bold label", () => {
			const band = bandPainter(3, [30, 30, 30]);
			expect(renderMultiselect(view({ cursor: 0 }), 40, colour, band)[1]).toBe(
				` \x1b[38;2;167;139;250m▌\x1b[39m\x1b[48;2;60;54;78m ${PICKED} \x1b[1mlaravel\x1b[22m         \x1b[2mpack · 14 skills\x1b[22m${gap(2)}\x1b[49m`,
			);
		});

		it("dims the count and paints the warning in the attention colour", () => {
			expect(
				renderMultiselect(
					view({ picked: [], warning: "pick at least one" }),
					80,
					colour,
				).at(-1),
			).toBe(
				`   \x1b[33mpick at least one\x1b[39m${gap(46)}\x1b[2m0 of 5 picked\x1b[22m`,
			);
		});
	});
});

describe("promptMultiselect", () => {
	const ask = (terminal: Terminal, required = false) =>
		promptMultiselect(
			{ message: "What to install", options: OPTIONS, required },
			terminal.context(),
		);

	it("shows its usual key hints, ending in esc cancel as a select's do", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal);
		await terminal.press();
		expect((await terminal.lines())[0]).toBe(
			` ? What to install${gap(11)}${HINTS}`,
		);
		await terminal.press(KEY.escape);
		await answer;
	});

	it("takes its key hints from the question when it gives them", async () => {
		const terminal = new Terminal(80);
		const answer = promptMultiselect(
			{ message: "Pick", options: OPTIONS, hints: "space pick · ⏎ install" },
			terminal.context(),
		);
		await terminal.press();
		expect((await terminal.lines())[0]).toBe(
			` ? Pick${gap(50)}space pick · ⏎ install`,
		);
		await terminal.press(KEY.escape);
		await answer;
	});

	it("shows no more options than leave its frame a line short of the screen", async () => {
		const terminal = new Terminal(80, 8);
		terminal.output.write("before\n");
		const answer = ask(terminal);
		await terminal.press(KEY.down, KEY.down, KEY.space);
		expect((await terminal.lines()).slice(1)).toEqual([
			` ? What to install${gap(11)}${HINTS}`,
			"   ↑ 1 more",
			"   ○ nuxt            pack · 9 skills, 2 folders",
			" ▌ ● python          pack · 11 skills",
			"   ↓ 2 more",
			"",
			`${gap(66)}1 of 5 picked`,
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual(["python"]);
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("asks its above for the room the question, its options and its footer leave, and erases what it gives with it", async () => {
		const terminal = new Terminal(80, 14);
		terminal.output.write("before\n");
		const rooms: number[] = [];
		const answer = promptMultiselect(
			{
				message: "What to install",
				options: OPTIONS,
				above: (room) => {
					rooms.push(room);
					return [" ✓ owner/repo   HEAD", ""];
				},
			},
			terminal.context(),
		);
		await terminal.press(KEY.space);
		expect(rooms).toEqual([5]);
		expect((await terminal.lines()).slice(1)).toEqual([
			" ✓ owner/repo   HEAD",
			"",
			` ? What to install${gap(11)}${HINTS}`,
			" ▌ ● laravel         pack · 14 skills",
			"   ○ nuxt            pack · 9 skills, 2 folders",
			"   ○ python          pack · 11 skills",
			"   ○ git-hygiene     Keep commits small and messages honest",
			"   ○ release-notes   Draft release notes from the changes since the last tag",
			"",
			`${gap(66)}1 of 5 picked`,
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual(["laravel"]);
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("keeps its options' share of the screen under a row that would take all of it", async () => {
		const terminal = new Terminal(80, 12);
		const answer = promptMultiselect(
			{
				message: "What to install",
				options: OPTIONS,
				above: (room) =>
					Array.from({ length: room }, (_, index) => `   · child ${index}`),
			},
			terminal.context(),
		);
		await terminal.press(KEY.space);
		expect(await terminal.lines()).toEqual([
			"   · child 0",
			"   · child 1",
			"   · child 2",
			` ? What to install${gap(11)}${HINTS}`,
			" ▌ ● laravel         pack · 14 skills",
			"   ○ nuxt            pack · 9 skills, 2 folders",
			"   ○ python          pack · 11 skills",
			"   ○ git-hygiene     Keep commits small and messages honest",
			"   ○ release-notes   Draft release notes from the changes since the last tag",
			"",
			`${gap(66)}1 of 5 picked`,
		]);
		await terminal.press(KEY.enter);
		await answer;
	});

	it("picks and unpicks the cursor's option with space", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal);
		await terminal.press(KEY.space);
		expect((await terminal.lines()).slice(1, 3)).toEqual([
			" ▌ ● laravel         pack · 14 skills",
			"   ○ nuxt            pack · 9 skills, 2 folders",
		]);
		await terminal.press(KEY.space);
		expect((await terminal.lines())[1]).toBe(
			" ▌ ○ laravel         pack · 14 skills",
		);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual([]);
	});

	it("returns what's picked in the options' order, not the picking's", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.down, KEY.down, KEY.space, KEY.up, "k", KEY.space);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual(["laravel", "python"]);
	});

	it("wraps round the ends", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.up, KEY.space, "j", "j", KEY.space, KEY.enter);
		expect(await answer).toEqual(["nuxt", "release-notes"]);
	});

	it("picks everything with a, and nothing with a again", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal);
		await terminal.press("a");
		expect((await terminal.lines()).at(-1)).toBe(`${gap(66)}5 of 5 picked`);
		await terminal.press("a");
		expect((await terminal.lines()).at(-1)).toBe(`${gap(66)}0 of 5 picked`);
		await terminal.press(KEY.space, "a", KEY.enter);
		expect(await answer).toEqual(OPTIONS.map(({ value }) => value));
	});

	it("submits nothing picked when it isn't required", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual([]);
	});

	it("picks nothing from an empty list", async () => {
		const terminal = new Terminal();
		const answer = promptMultiselect(
			{ message: "Pick", options: [] },
			terminal.context(),
		);
		await terminal.press(KEY.space, "a", KEY.enter);
		expect(await answer).toEqual([]);
	});

	it("holds enter back while required finds nothing picked, warning until a pick", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal, true);
		await terminal.press(KEY.enter, KEY.down);
		expect((await terminal.lines()).at(-1)).toBe(
			`   pick at least one${gap(46)}0 of 5 picked`,
		);
		await terminal.press(KEY.space);
		expect((await terminal.lines()).at(-1)).toBe(`${gap(66)}1 of 5 picked`);
		await terminal.press(KEY.enter);
		expect(await answer).toEqual(["nuxt"]);
	});

	it("doesn't warn again for unpicking, only for another empty enter", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal, true);
		await terminal.press(KEY.enter, KEY.space, KEY.space);
		expect((await terminal.lines()).at(-1)).toBe(`${gap(66)}0 of 5 picked`);
		await terminal.press(KEY.enter);
		expect((await terminal.lines()).at(-1)).toBe(
			`   pick at least one${gap(46)}0 of 5 picked`,
		);
		await terminal.press(KEY.escape);
		expect(await answer).toEqual([]);
	});

	it.each([
		["esc", KEY.escape],
		["ctrl-c", KEY.ctrlC],
	])("returns nothing on %s, whatever was picked", async (_name, key) => {
		const terminal = new Terminal();
		const answer = ask(terminal, true);
		await terminal.press("a", key);
		expect(await answer).toEqual([]);
	});
});
