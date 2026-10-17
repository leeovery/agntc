import { describe, expect, it } from "vitest";
import {
	promptConfirm,
	renderConfirm,
} from "../../../src/terminal/prompts/confirm.js";
import { createStyle } from "../../../src/terminal/style.js";
import { KEY, Terminal } from "./terminal.js";

const plain = createStyle(0);
const gap = (columns: number) => " ".repeat(columns);
const YES = " ? Proceed?   [Yes]  No";
const NO = " ? Proceed?    Yes  [No]";
const QUESTION = " \x1b[38;2;167;139;250m?\x1b[39m \x1b[1mProceed?\x1b[22m";
const ON_ACCENT = "\x1b[48;2;167;139;250;38;2;17;17;17m";

const proceed = (value: boolean, hints = "") => ({
	message: "Proceed?",
	hints,
	value,
});

describe("renderConfirm", () => {
	it.each([40, 80, 100])("draws both buttons, yes chosen, at %i", (width) => {
		expect(renderConfirm(proceed(true), width, plain)).toEqual([YES]);
	});

	it.each([40, 80, 100])("draws both buttons, no chosen, at %i", (width) => {
		expect(renderConfirm(proceed(false), width, plain)).toEqual([NO]);
	});

	it("puts the buttons on a line of their own when the question can't share one", () => {
		expect(
			renderConfirm(
				{ ...proceed(true), message: "Remove it and its 11 folders?" },
				40,
				plain,
			),
		).toEqual([" ? Remove it and its 11 folders?", "   [Yes]  No"]);
		expect(
			renderConfirm(
				{
					...proceed(false),
					message:
						"Remove leeovery/agentic-skills/nuxt and its 11 folders from this project?",
				},
				40,
				plain,
			),
		).toEqual([
			" ? Remove leeovery/agentic-skills/nuxt",
			"   and its 11 folders from this",
			"   project?",
			"    Yes  [No]",
		]);
	});

	it("keeps the buttons beside the question only while the line leaves the last column free", () => {
		expect(renderConfirm(proceed(true), YES.length + 1, plain)).toEqual([YES]);
		expect(renderConfirm(proceed(true), YES.length, plain)).toEqual([
			" ? Proceed?",
			"   [Yes]  No",
		]);
	});

	it("shows key hints on the right only when given", () => {
		expect(renderConfirm(proceed(true, "y yes · n no"), 80, plain)).toEqual([
			`${YES}${gap(44)}y yes · n no`,
		]);
		expect(renderConfirm(proceed(true, "y yes · n no"), 40, plain)).toEqual([
			YES,
		]);
	});

	it("paints the chosen button in the accent with dark bold text, the other dim", () => {
		const colour = createStyle(3);
		expect(renderConfirm(proceed(true), 80, colour)).toEqual([
			`${QUESTION}   ${ON_ACCENT}\x1b[1m Yes \x1b[22m\x1b[49;39m  \x1b[2mNo\x1b[22m`,
		]);
		expect(renderConfirm(proceed(false), 80, colour)).toEqual([
			`${QUESTION}    \x1b[2mYes\x1b[22m  ${ON_ACCENT}\x1b[1m No \x1b[22m\x1b[49;39m`,
		]);
	});

	it("paints the chosen button magenta with black text at 16 colours", () => {
		expect(renderConfirm(proceed(true), 80, createStyle(1))[0]).toContain(
			"\x1b[45;30m\x1b[1m Yes \x1b[22m\x1b[49;39m",
		);
	});
});

describe("promptConfirm", () => {
	const ask = (terminal: Terminal, initialValue?: boolean) =>
		promptConfirm(
			{
				message: "Proceed?",
				...(initialValue === undefined ? {} : { initialValue }),
			},
			terminal.context(),
		);

	it("starts on yes and submits it on enter", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press();
		expect(await terminal.lines()).toEqual([YES]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(true);
	});

	it("starts on the initial value it's given", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal, false);
		await terminal.press();
		expect(await terminal.lines()).toEqual([NO]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(false);
	});

	it("changes the choice with tab, each way", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.tab);
		expect(await terminal.lines()).toEqual([NO]);
		await terminal.press(KEY.tab);
		expect(await terminal.lines()).toEqual([YES]);
		await terminal.press(KEY.tab, KEY.enter);
		expect(await answer).toBe(false);
	});

	it.each([
		["←", KEY.left],
		["h", "h"],
	])("chooses yes with %s, and keeps it there", async (_name, key) => {
		const terminal = new Terminal();
		const answer = ask(terminal, false);
		await terminal.press(key);
		expect(await terminal.lines()).toEqual([YES]);
		await terminal.press(key);
		expect(await terminal.lines()).toEqual([YES]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(true);
	});

	it.each([
		["→", KEY.right],
		["l", "l"],
	])("chooses no with %s, and keeps it there", async (_name, key) => {
		const terminal = new Terminal();
		const answer = ask(terminal, true);
		await terminal.press(key);
		expect(await terminal.lines()).toEqual([NO]);
		await terminal.press(key);
		expect(await terminal.lines()).toEqual([NO]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(false);
	});

	it("leaves the choice alone for ↑↓ and space", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.up, KEY.down, "j", KEY.space);
		expect(await terminal.lines()).toEqual([YES]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(true);
	});

	it("answers yes at once on y, whatever is chosen", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal, false);
		await terminal.press("y");
		expect(await answer).toBe(true);
	});

	it("answers no at once on n, whatever is chosen", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal, true);
		await terminal.press("n");
		expect(await answer).toBe(false);
	});

	it("draws the lines it's given over its question, cut to leave room for it, and erases them with it", async () => {
		const terminal = new Terminal(80, 4);
		terminal.output.write("before\n");
		const answer = promptConfirm(
			{
				message: "Proceed?",
				above: [" ✓ owner/repo   HEAD", "   · a", "   · b", ""],
			},
			terminal.context(),
		);
		await terminal.press();
		expect((await terminal.lines()).slice(1)).toEqual([
			" ✓ owner/repo   HEAD",
			"   … 3 more",
			YES,
		]);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(true);
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("closes once on y, with a single newline", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press("y");
		await answer;
		expect(terminal.output.text.match(/\n/g)).toHaveLength(1);
	});

	it.each([
		["esc", KEY.escape],
		["ctrl-c", KEY.ctrlC],
	])("returns false on %s, though yes is chosen", async (_name, key) => {
		const terminal = new Terminal();
		const answer = ask(terminal, true);
		await terminal.press(key);
		expect(await answer).toBe(false);
	});
});
