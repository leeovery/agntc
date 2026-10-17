import { describe, expect, it } from "vitest";
import {
	footerLine,
	promptSelect,
	renderSelect,
	type SelectView,
	selectWindow,
} from "../../../src/terminal/prompts/select.js";
import { bandPainter, createStyle } from "../../../src/terminal/style.js";
import type { SelectFooter, SelectOption } from "../../../src/ui.js";
import { KEY, Terminal } from "./terminal.js";

const plain = createStyle(0);
const colour = createStyle(3);
const gap = (columns: number) => " ".repeat(columns);
const HINTS = "↑↓ move · ⏎ choose · esc cancel";
const ACCENT = "\x1b[38;2;167;139;250m";
const BAR = `${ACCENT}▌\x1b[39m`;

const OPTIONS: SelectOption<string>[] = [
	{ value: "laravel", label: "laravel", hint: "pack · 14 skills" },
	{ value: "nuxt", label: "nuxt", hint: "pack · 9 skills, 2 folders" },
	{
		value: "git-hygiene",
		label: "git-hygiene",
		hint: "Keep commits small and messages honest",
	},
];

const GROUPED: SelectOption<string>[] = [
	{ heading: "leeovery/agentic-skills" },
	{ value: "laravel", label: "laravel", hint: "pack" },
	{ value: "nuxt", label: "nuxt", hint: "pack" },
	{ heading: "github/gh-stack" },
	{ value: "gh-stack", label: "gh-stack", hint: "skill" },
];

const TEN: SelectOption<string>[] = Array.from({ length: 10 }, (_, index) => {
	const name = `skill-${String(index + 1).padStart(2, "0")}`;
	return { value: name, label: name };
});

function view(
	options: readonly SelectOption<string>[],
	cursor: number,
	more: Partial<SelectView<string>> = {},
): SelectView<string> {
	return {
		message: "What to install",
		hints: HINTS,
		options,
		cursor,
		top: 0,
		size: 10,
		more: true,
		...more,
	};
}

describe("renderSelect", () => {
	it.each([
		[80, 30],
		[100, 50],
	])("puts the hints on the question's right at %i", (width, spaces) => {
		expect(renderSelect(view(OPTIONS, 0), width, plain)[0]).toBe(
			` ? What to install${gap(spaces)}${HINTS}`,
		);
	});

	it("drops the hints below 60 columns", () => {
		expect(renderSelect(view(OPTIONS, 0), 59, plain)[0]).toBe(
			" ? What to install",
		);
	});

	it("drops the hints when they don't fit beside the question", () => {
		const long = "Select a skill or pack to manage, or press escape when done";
		expect(
			renderSelect({ ...view(OPTIONS, 0), message: long }, 80, plain)[0],
		).toBe(` ? ${long}`);
	});

	it.each([
		80, 100,
	])("draws the cursor on each option in turn at %i", (width) => {
		const rows = [
			"laravel       pack · 14 skills",
			"nuxt          pack · 9 skills, 2 folders",
			"git-hygiene   Keep commits small and messages honest",
		];
		for (const cursor of [0, 1, 2]) {
			expect(
				renderSelect(view(OPTIONS, cursor), width, plain).slice(1),
			).toEqual(
				rows.map((row, index) => `${index === cursor ? " ▌ " : "   "}${row}`),
			);
		}
	});

	it("cuts the hints with … to fit at 40", () => {
		expect(renderSelect(view(OPTIONS, 1), 40, plain)).toEqual([
			" ? What to install",
			"   laravel       pack · 14 skills",
			" ▌ nuxt          pack · 9 skills, 2 fo…",
			"   git-hygiene   Keep commits small an…",
		]);
	});

	it("draws headings bold at column 3, their options two further in, never under the cursor", () => {
		expect(renderSelect(view(GROUPED, 1), 80, plain).slice(1)).toEqual([
			"   leeovery/agentic-skills",
			" ▌   laravel    pack",
			"     nuxt       pack",
			"   github/gh-stack",
			"     gh-stack   skill",
		]);
		expect(renderSelect(view(GROUPED, 4), 80, colour)[4]).toBe(
			"   \x1b[1mgithub/gh-stack\x1b[22m",
		);
	});

	it("keeps an option above every heading at column 3, the hints in one column", () => {
		const options: SelectOption<string>[] = [
			{ value: "all", label: "all", hint: "every entry" },
			{ heading: "owner/repo" },
			{ value: "a", label: "a", hint: "skill" },
		];
		expect(renderSelect(view(options, 2), 80, plain).slice(1)).toEqual([
			"   all   every entry",
			"   owner/repo",
			" ▌   a   skill",
		]);
	});

	it("bands the whole cursor row under a heading, its inset included", () => {
		const band = bandPainter(3, [30, 30, 30]);
		expect(renderSelect(view(GROUPED, 1), 40, colour, band)[2]).toBe(
			` ${BAR}\x1b[48;2;60;54;78m   \x1b[1mlaravel\x1b[22m    \x1b[2mpack\x1b[22m${gap(19)}\x1b[49m`,
		);
	});

	describe("a long list", () => {
		it("shows the window from the top with a more line below", () => {
			expect(
				renderSelect(view(TEN, 0, { size: 5 }), 80, plain).slice(1),
			).toEqual([
				" ▌ skill-01",
				"   skill-02",
				"   skill-03",
				"   skill-04",
				"   skill-05",
				"   ↓ 5 more",
			]);
		});

		it("shows more lines either side in the middle", () => {
			expect(
				renderSelect(view(TEN, 5, { top: 3, size: 5 }), 80, plain).slice(1),
			).toEqual([
				"   ↑ 3 more",
				"   skill-04",
				"   skill-05",
				" ▌ skill-06",
				"   skill-07",
				"   skill-08",
				"   ↓ 2 more",
			]);
		});

		it("shows a more line above at the bottom", () => {
			expect(
				renderSelect(view(TEN, 9, { top: 5, size: 5 }), 40, plain).slice(1),
			).toEqual([
				"   ↑ 5 more",
				"   skill-06",
				"   skill-07",
				"   skill-08",
				"   skill-09",
				" ▌ skill-10",
			]);
		});

		it("counts the options hidden, not the headings", () => {
			expect(
				renderSelect(view(GROUPED, 4, { top: 3, size: 2 }), 80, plain).slice(1),
			).toEqual(["   ↑ 2 more", "   github/gh-stack", " ▌   gh-stack   skill"]);
		});

		it("cuts the more lines to the room the last column leaves", () => {
			const lines = renderSelect(view(TEN, 5, { top: 3, size: 5 }), 10, plain);
			expect(lines.filter((line) => /[↑↓]/.test(line))).toEqual([
				"   ↑ 3 m…",
				"   ↓ 2 m…",
			]);
		});

		it("paints the more lines dim", () => {
			expect(renderSelect(view(TEN, 0, { size: 5 }), 80, colour).at(-1)).toBe(
				"   \x1b[2m↓ 5 more\x1b[22m",
			);
		});

		it("leaves the more lines out when the window has no room for them", () => {
			expect(
				renderSelect(
					view(TEN, 5, { top: 4, size: 2, more: false }),
					80,
					plain,
				).slice(1),
			).toEqual(["   skill-05", " ▌ skill-06"]);
		});
	});

	describe("long labels", () => {
		const options: SelectOption<string>[] = [
			{ value: "x", label: "x", hint: "skill" },
			{ value: "kit", label: "macos-app-design-kit", hint: "skill" },
			{ value: "long", label: "x".repeat(40), hint: "skill" },
		];

		it("caps the label column, cutting a wider label at its start to keep its hint in the column at 40", () => {
			expect(renderSelect(view(options, 0), 40, plain).slice(1)).toEqual([
				` ▌ x${gap(17)}skill`,
				"   …-app-design-kit  skill",
				`   …${"x".repeat(15)}  skill`,
			]);
		});

		it("keeps a label that fits its column whole at 80, cutting only the wider one", () => {
			expect(renderSelect(view(options, 2), 80, plain).slice(1)).toEqual([
				`   x${gap(35)}skill`,
				`   macos-app-design-kit${gap(16)}skill`,
				` ▌ …${"x".repeat(33)}  skill`,
			]);
		});

		it("tells long keys apart by their tails, each hint in its column, at 100", () => {
			const root = "/Volumes/Scratch/tmp/claude-501/a-long-session-folder/3a";
			const keys: SelectOption<string>[] = [
				{ value: "a", label: `${root}/two-skills/alpha`, hint: "✓ up to date" },
				{ value: "b", label: `${root}/two-skills/beta`, hint: "◇ local" },
			];
			expect(renderSelect(view(keys, 0), 100, plain).slice(1)).toEqual([
				" ▌ …/a-long-session-folder/3a/two-skills/alpha  ✓ up to date",
				"   …1/a-long-session-folder/3a/two-skills/beta  ◇ local",
			]);
		});

		it("takes the room for a label without a hint, cut at its start", () => {
			const long: SelectOption<string>[] = [
				{ value: "a", label: `${"x".repeat(40)}/alpha` },
			];
			expect(renderSelect(view(long, 0), 40, plain).slice(1)).toEqual([
				` ▌ …${"x".repeat(29)}/alpha`,
			]);
		});
	});

	describe("long headings", () => {
		it("are cut at their start, as a local path is told apart by its tail", () => {
			const headed: SelectOption<string>[] = [
				{ heading: `~/Code/${"x".repeat(40)}/my-skills` },
				{ value: "a", label: "drafting" },
			];
			expect(renderSelect(view(headed, 1), 40, plain)[1]).toBe(
				`   …${"x".repeat(25)}/my-skills`,
			);
		});
	});

	describe("the cursor row in colour", () => {
		const body = `\x1b[1mlaravel\x1b[22m       \x1b[2mpack · 14 skills\x1b[22m`;

		it("has an accent bar and a bold label, its hint dim", () => {
			expect(renderSelect(view(OPTIONS, 0), 40, colour)[1]).toBe(
				` ${BAR} ${body}`,
			);
		});

		it("carries the band from column 2 to the margin at truecolor", () => {
			const band = bandPainter(3, [30, 30, 30]);
			expect(renderSelect(view(OPTIONS, 0), 40, colour, band)[1]).toBe(
				` ${BAR}\x1b[48;2;60;54;78m ${body}${gap(6)}\x1b[49m`,
			);
		});

		it("draws the band as the nearest 256-colour at level 2", () => {
			const style = createStyle(2);
			const band = bandPainter(2, [30, 30, 30]);
			expect(renderSelect(view(OPTIONS, 0), 40, style, band)[1]).toBe(
				` \x1b[38;5;141m▌\x1b[39m\x1b[48;5;238m ${body}${gap(6)}\x1b[49m`,
			);
		});

		it("leaves the other rows unbanded and their labels plain", () => {
			const band = bandPainter(3, [30, 30, 30]);
			expect(renderSelect(view(OPTIONS, 0), 40, colour, band)[2]).toBe(
				"   nuxt          \x1b[2mpack · 9 skills, 2 fo…\x1b[22m",
			);
		});
	});
});

describe("a select's cells", () => {
	const DASHBOARD: SelectOption<string>[] = [
		{ heading: "leeovery/agentic-skills" },
		{
			value: "laravel",
			label: "laravel",
			cells: [
				{ text: "pack", dim: true },
				{ text: "v0.2.4", aside: "^0.2.4" },
				{ status: "newer", text: "v0.2.5" },
			],
		},
		{
			value: "agentic-workflows",
			label: "agentic-workflows",
			cells: [
				{ text: "skill", dim: true },
				{ text: "v0.8.18", aside: "^0.8.18" },
				{ status: "done", text: "up to date", dim: true },
			],
		},
		{ heading: "~/Code/my-skills" },
		{
			value: "drafting",
			label: "drafting",
			cells: [
				{ text: "skill", dim: true },
				{ text: "local" },
				{ status: "local", text: "local", dim: true },
			],
		},
	];
	const lines = (width: number, cursor = 1, style = plain) =>
		renderSelect(view(DASHBOARD, cursor), width, style).slice(1);

	it("lines its cells up in columns laid out from every choice, the widest and 3 apart", () => {
		expect(lines(100)).toEqual([
			"   leeovery/agentic-skills",
			" ▌   laravel             pack    v0.2.4 ^0.2.4     ↑ v0.2.5",
			"     agentic-workflows   skill   v0.8.18 ^0.8.18   ✓ up to date",
			"   ~/Code/my-skills",
			"     drafting            skill   local             ◇ local",
		]);
	});

	it("drops the asides first where the line is too wide", () => {
		expect(lines(60)).toEqual([
			"   leeovery/agentic-skills",
			" ▌   laravel             pack    v0.2.4    ↑ v0.2.5",
			"     agentic-workflows   skill   v0.8.18   ✓ up to date",
			"   ~/Code/my-skills",
			"     drafting            skill   local     ◇ local",
		]);
	});

	it("then the cells before the last, from the right, keeping the status", () => {
		expect(lines(46)).toEqual([
			"   leeovery/agentic-skills",
			" ▌   laravel             pack    ↑ v0.2.5",
			"     agentic-workflows   skill   ✓ up to date",
			"   ~/Code/my-skills",
			"     drafting            skill   ◇ local",
		]);
		expect(lines(40)).toEqual([
			"   leeovery/agentic-skills",
			" ▌   laravel             ↑ v0.2.5",
			"     agentic-workflows   ✓ up to date",
			"   ~/Code/my-skills",
			"     drafting            ◇ local",
		]);
	});

	it("then cuts the labels at their start, as a name is told apart by its tail", () => {
		const long: SelectOption<string>[] = [
			{
				value: "a",
				label: "a-skill-with-a-name-long-enough-to-crowd-its-status",
				cells: [{ status: "failed", text: "no matching version" }],
			},
		];
		const [line] = renderSelect(view(long, 0), 40, plain).slice(1);
		expect(line).toBe(" ▌ …-its-status   ✗ no matching version");
		expect(line!.length).toBeLessThanOrEqual(39);
	});

	it("cuts a line its last cell alone overflows at the margin", () => {
		const wide: SelectOption<string>[] = [
			{
				value: "a",
				label: "a",
				cells: [{ status: "failed", text: "x".repeat(60) }],
			},
		];
		const [line] = renderSelect(view(wide, 0), 40, plain).slice(1);
		expect(line).toBe(` ▌ ✗ ${"x".repeat(33)}…`);
	});

	it("paints the kind dim, the constraint dim, each glyph in its status's colour, and bolds the cursor's label", () => {
		const [, cursorRow, other] = lines(100, 1, colour);
		expect(cursorRow).toBe(
			` ${BAR}   \x1b[1mlaravel\x1b[22m             \x1b[2mpack\x1b[22m    v0.2.4 \x1b[2m^0.2.4\x1b[22m     ${ACCENT}↑\x1b[39m v0.2.5`,
		);
		expect(other).toBe(
			"     agentic-workflows   \x1b[2mskill\x1b[22m   v0.8.18 \x1b[2m^0.8.18\x1b[22m   \x1b[32m✓\x1b[39m \x1b[2mup to date\x1b[22m",
		);
	});
});

describe("a select's footer", () => {
	const FOOTER: SelectFooter = {
		keys: ["⏎ manage", "esc done"],
		counts: [
			{ count: 3, label: "updates", status: "newer" },
			{ count: 0, label: "with newer tags", status: "attention" },
			{ count: 1, label: "check failed", status: "failed" },
		],
	};
	const footed = (width: number, more: Partial<SelectView<string>> = {}) =>
		renderSelect(
			view(GROUPED, 1, { hints: "", footer: FOOTER, ...more }),
			width,
			plain,
		);

	it("sits under the options a blank line apart: its keys on the left, the counts it has on the right", () => {
		expect(footed(100).slice(-2)).toEqual([
			"",
			` ↑↓ move   ⏎ manage   esc done${gap(43)}3 updates · 1 check failed`,
		]);
	});

	it("cuts the counts before the keys where both don't fit", () => {
		const crowded: SelectFooter = {
			keys: FOOTER.keys,
			counts: [
				...(FOOTER.counts ?? []),
				{ count: 2, label: "with no match", status: "failed" },
			],
		};
		const line = footerLine(crowded, 60, plain);
		expect(line).toBe(
			" ↑↓ move   ⏎ manage   esc done  3 updates · 1 check failed…",
		);
		expect(line.length).toBe(59);
	});

	it("drops the keys below 60 columns, the counts at the right margin", () => {
		expect(footed(59).slice(-1)).toEqual([
			`${gap(32)}3 updates · 1 check failed`,
		]);
	});

	it("is the keys alone when nothing is counted", () => {
		expect(footerLine({ keys: ["⏎ manage"], counts: [] }, 80, plain)).toBe(
			" ↑↓ move   ⏎ manage",
		);
	});

	it("paints the keys dim and each count in its status's colour", () => {
		expect(footerLine(FOOTER, 100, colour)).toBe(
			` \x1b[2m↑↓ move   ⏎ manage   esc done\x1b[22m${gap(43)}${ACCENT}3 updates\x1b[39m\x1b[2m · \x1b[22m\x1b[31m1 check failed\x1b[39m`,
		);
	});

	it("shows only as many of its lines as the window leaves it, its last first", () => {
		expect(footed(100, { footerLines: 1 }).slice(-1)[0]).toMatch(/^ ↑↓ move/);
		expect(footed(100, { footerLines: 1 }).at(-2)).not.toBe("");
		expect(footed(100, { footerLines: 0 }).at(-1)).toBe(
			"     gh-stack   skill",
		);
	});

	it("takes the key hints off the question's line", async () => {
		const terminal = new Terminal(100, 20);
		const answer = promptSelect(
			{ message: "Manage", options: GROUPED, footer: FOOTER },
			terminal.context(),
		);
		await terminal.press();
		const frame = await terminal.lines();
		expect(frame[0]).toBe(" ? Manage");
		expect(frame.at(-1)).toMatch(
			/^ ↑↓ move {3}⏎ manage {3}esc done +3 updates/,
		);
		await terminal.press(KEY.escape);
		expect(await answer).toBeNull();
	});

	it("counts in the frame's fit, giving up the more lines, then its blank line, before the options", () => {
		const question = { message: "Manage", options: TEN, footer: FOOTER };
		expect(selectWindow(question, 24, 100, plain)).toMatchObject({
			size: 10,
			footerLines: 2,
		});
		expect(selectWindow(question, 13, 100, plain)).toMatchObject({
			size: 7,
			more: true,
			footerLines: 2,
		});
		expect(selectWindow(question, 4, 100, plain)).toMatchObject({
			size: 1,
			more: false,
			footerLines: 1,
		});
	});
});

describe("promptSelect", () => {
	const ask = (terminal: Terminal, options = OPTIONS) =>
		promptSelect({ message: "What to install", options }, terminal.context());

	it("draws the question and the options, the cursor on the first", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal);
		await terminal.press();
		expect(await terminal.lines()).toEqual([
			` ? What to install${gap(30)}${HINTS}`,
			" ▌ laravel       pack · 14 skills",
			"   nuxt          pack · 9 skills, 2 folders",
			"   git-hygiene   Keep commits small and messages honest",
		]);
		await terminal.press(KEY.enter);
		await answer;
	});

	it("moves the cursor down and up, redrawing in place", async () => {
		const terminal = new Terminal(80);
		const answer = ask(terminal);
		await terminal.press(KEY.down);
		expect((await terminal.lines()).slice(1, 3)).toEqual([
			"   laravel       pack · 14 skills",
			" ▌ nuxt          pack · 9 skills, 2 folders",
		]);
		await terminal.press(KEY.up, KEY.enter);
		expect(await answer).toBe("laravel");
	});

	it("returns the value under the cursor on enter", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.down, KEY.enter);
		expect(await answer).toBe("nuxt");
	});

	it("moves with j and k", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press("j", "j", "k", KEY.enter);
		expect(await answer).toBe("nuxt");
	});

	it("wraps round from the first to the last and back", async () => {
		const up = new Terminal();
		const last = ask(up);
		await up.press(KEY.up, KEY.enter);
		expect(await last).toBe("git-hygiene");

		const down = new Terminal();
		const first = ask(down);
		await down.press(KEY.down, KEY.down, KEY.down, KEY.enter);
		expect(await first).toBe("laravel");
	});

	it("starts past a leading heading and passes over the others", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal, GROUPED);
		await terminal.press(KEY.down, KEY.down);
		expect((await terminal.lines()).slice(1)).toEqual([
			"   leeovery/agentic-skills",
			"     laravel    pack",
			"     nuxt       pack",
			"   github/gh-stack",
			" ▌   gh-stack   skill",
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("gh-stack");
	});

	it("wraps past the headings both ways", async () => {
		const down = new Terminal();
		const first = ask(down, GROUPED);
		await down.press(KEY.down, KEY.down, KEY.down, KEY.enter);
		expect(await first).toBe("laravel");

		const up = new Terminal();
		const last = ask(up, GROUPED);
		await up.press(KEY.up, KEY.up, KEY.enter);
		expect(await last).toBe("nuxt");
	});

	it.each([
		["esc", KEY.escape],
		["ctrl-c", KEY.ctrlC],
	])("returns null on %s", async (_name, key) => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.down, key);
		expect(await answer).toBeNull();
	});

	it("returns null for a list with nothing to choose", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal, [{ heading: "owner/repo" }]);
		await terminal.press(KEY.down, KEY.enter);
		expect(await answer).toBeNull();
	});

	it("scrolls a list longer than the terminal leaves room for, a line short of the screen", async () => {
		const terminal = new Terminal(80, 11);
		const answer = ask(terminal, TEN);
		await terminal.press(...Array.from({ length: 8 }, () => KEY.down));
		expect((await terminal.lines()).slice(1)).toEqual([
			"   ↑ 2 more",
			"   skill-03",
			"   skill-04",
			"   skill-05",
			"   skill-06",
			"   skill-07",
			"   skill-08",
			" ▌ skill-09",
			"   ↓ 1 more",
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("skill-09");
	});

	it("shows no more of the prompt's own number than the screen has room for", async () => {
		const terminal = new Terminal(80, 8);
		terminal.output.write("before\n");
		const answer = promptSelect(
			{ message: "Pick a version", options: TEN, maxItems: 15 },
			terminal.context(),
		);
		await terminal.press(KEY.down, KEY.down, KEY.down, KEY.down);
		const frame = await terminal.lines();
		expect(frame.length - 1).toBeLessThanOrEqual(7);
		await terminal.press(KEY.down, KEY.enter);
		expect(await answer).toBe("skill-06");
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("shows the prompt's own number of lines", async () => {
		const terminal = new Terminal();
		const answer = promptSelect(
			{ message: "Pick", options: TEN, maxItems: 3 },
			terminal.context(),
		);
		await terminal.press(KEY.up);
		expect((await terminal.lines()).slice(1)).toEqual([
			"   ↑ 7 more",
			"   skill-08",
			"   skill-09",
			" ▌ skill-10",
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("skill-10");
	});

	it("gives the options the room its above leaves unused, and erases what it gives with it", async () => {
		const terminal = new Terminal(80, 14);
		terminal.output.write("before\n");
		const rooms: number[] = [];
		const answer = promptSelect(
			{
				message: "Pick",
				options: TEN,
				above: (room) => {
					rooms.push(room);
					return [" ✓ owner/repo   HEAD", ""];
				},
			},
			terminal.context(),
		);
		await terminal.press(KEY.down);
		expect(rooms).toEqual([4]);
		expect((await terminal.lines()).slice(1)).toEqual([
			" ✓ owner/repo   HEAD",
			"",
			` ? Pick${gap(41)}${HINTS}`,
			"   skill-01",
			" ▌ skill-02",
			...["03", "04", "05", "06", "07", "08", "09", "10"].map(
				(n) => `   skill-${n}`,
			),
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("skill-02");
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("keeps half the frame for its options under a row that would take all of it", async () => {
		const terminal = new Terminal(80, 8);
		const answer = promptSelect(
			{
				message: "Pick",
				options: TEN,
				above: (room) =>
					Array.from({ length: room }, (_, index) => `   · child ${index}`),
			},
			terminal.context(),
		);
		await terminal.press();
		expect(await terminal.lines()).toEqual([
			"   · child 0",
			` ? Pick${gap(41)}${HINTS}`,
			" ▌ skill-01",
			"   skill-02",
			"   skill-03",
			"   ↓ 7 more",
		]);
		await terminal.press(KEY.enter);
		await answer;
	});

	it("takes its key hints from the question when it gives them", async () => {
		const terminal = new Terminal(80);
		const answer = promptSelect(
			{ message: "Manage", options: OPTIONS, hints: "⏎ manage · esc done" },
			terminal.context(),
		);
		await terminal.press();
		expect((await terminal.lines())[0]).toBe(
			` ? Manage${gap(51)}⏎ manage · esc done`,
		);
		await terminal.press(KEY.escape);
		await answer;
	});
});
