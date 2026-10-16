import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { promptConfirm } from "../../../src/terminal/prompts/confirm.js";
import { promptMultiselect } from "../../../src/terminal/prompts/multiselect.js";
import { promptSelect } from "../../../src/terminal/prompts/select.js";
import { KEY, Terminal } from "./terminal.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const EXIT_EVENTS = ["exit", "SIGINT", "SIGTERM"] as const;

const CHOICES = [
	{ value: "laravel", label: "laravel", hint: "pack · 14 skills" },
	{ value: "nuxt", label: "nuxt", hint: "pack · 9 skills" },
	{ value: "macos", label: "macos", hint: "skill" },
];

const PROMPTS = {
	select: (terminal: Terminal) =>
		promptSelect(
			{
				message: "Manage",
				options: [{ heading: "leeovery/agentic-skills" }, ...CHOICES],
			},
			terminal.context(),
		),
	multiselect: (terminal: Terminal) =>
		promptMultiselect(
			{ message: "What to install", options: CHOICES },
			terminal.context(),
		),
	confirm: (terminal: Terminal) =>
		promptConfirm({ message: "Remove it?" }, terminal.context()),
};
const NAMES = Object.keys(PROMPTS) as (keyof typeof PROMPTS)[];

const listening = (terminal: Terminal) =>
	EXIT_EVENTS.map((event) => terminal.host.listenerCount(event));

describe.each(NAMES)("a %s", (name) => {
	const ask = PROMPTS[name];

	it.each([
		["submitted", KEY.enter],
		["cancelled with esc", KEY.escape],
		["cancelled with ctrl-c", KEY.ctrlC],
	])("leaves nothing on the screen once %s", async (_how, key) => {
		const terminal = new Terminal();
		terminal.output.write("before\n");
		const answer = ask(terminal);
		await terminal.press(KEY.down, KEY.space, KEY.tab);
		expect((await terminal.lines()).length).toBeGreaterThan(1);
		await terminal.press(key);
		await answer;
		expect(await terminal.lines()).toEqual(["before"]);
		expect(await terminal.cursor()).toEqual([0, 1]);
	});

	it("leaves the cursor where its first line began, for the next line to take", async () => {
		const terminal = new Terminal();
		terminal.output.write("before\n");
		const answer = ask(terminal);
		await terminal.press(KEY.enter);
		await answer;
		terminal.output.write(" ✓ next\n");
		expect(await terminal.lines()).toEqual(["before", " ✓ next"]);
	});

	it("erases itself at the foot of a full screen, the lines above it kept", async () => {
		const terminal = new Terminal(80, 8);
		const above = Array.from({ length: 7 }, (_, index) => `line ${index + 1}`);
		terminal.output.write(above.map((line) => `${line}\n`).join(""));
		const answer = ask(terminal);
		await terminal.press(KEY.down, KEY.enter);
		await answer;
		terminal.output.write("after\n");
		expect(await terminal.lines()).toEqual([...above, "after"]);
	});

	it("hides the cursor while it's open and shows it once answered", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press();
		expect(terminal.output.text.startsWith(HIDE)).toBe(true);
		expect(terminal.output.text).not.toContain(SHOW);
		await terminal.press(KEY.escape);
		await answer;
		expect(terminal.output.text).toContain(SHOW);
	});

	it("holds stdin in raw mode only while open", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press();
		expect(terminal.input.isRaw).toBe(true);
		await terminal.press(KEY.escape);
		await answer;
		expect(terminal.input.isRaw).toBe(false);
	});

	it("unpipes and pauses stdin once answered, leaving it nothing listening", async () => {
		const terminal = new Terminal();
		const untouched = terminal.input.eventNames();
		const answer = ask(terminal);
		await terminal.press();
		expect(terminal.input.listenerCount("data")).toBe(1);
		await terminal.press(KEY.enter);
		await answer;
		expect(terminal.input.listenerCount("data")).toBe(0);
		expect(terminal.input.eventNames()).toEqual(untouched);
		expect(terminal.input.isPaused()).toBe(true);
		expect(terminal.input.readableFlowing).toBe(false);
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const)("restores the terminal and exits on %s while open", async (signal, code) => {
		const terminal = new Terminal();
		terminal.output.write("before\n");
		const answer = ask(terminal);
		await terminal.press(KEY.down);
		terminal.host.emit(signal);
		expect(await terminal.lines()).toEqual(["before"]);
		expect(terminal.output.text.endsWith(SHOW)).toBe(true);
		expect(terminal.input.isRaw).toBe(false);
		expect(terminal.host.exit).toHaveBeenCalledWith(code);
		await terminal.press(KEY.escape);
		await answer;
		expect(listening(terminal)).toEqual([0, 0, 0]);
	});

	it("restores the terminal when the process exits while open", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press(KEY.down);
		terminal.host.emit("exit");
		expect(await terminal.lines()).toEqual([]);
		expect(terminal.output.text.endsWith(SHOW)).toBe(true);
		expect(terminal.input.isRaw).toBe(false);
		expect(terminal.host.exit).not.toHaveBeenCalled();
		await terminal.press(KEY.escape);
		await answer;
	});

	it("watches the process for exits only while open", async () => {
		const terminal = new Terminal();
		const answer = ask(terminal);
		await terminal.press();
		expect(listening(terminal)).toEqual([1, 1, 1]);
		await terminal.press(KEY.enter);
		await answer;
		expect(listening(terminal)).toEqual([0, 0, 0]);
	});
});

describe("a terminal's reply split after its ESC while a prompt is open", () => {
	// Read as keys, its a's would pick everything, and an ESC left alone for
	// 50 ms would be read as escape and cancel.
	it.each([
		3, 60,
	])("is never read as keys, the rest coming %i ms after the ESC", async (gap) => {
		const terminal = new Terminal();
		const answer = PROMPTS.multiselect(terminal);
		await terminal.press();
		const opened = await terminal.lines();
		await terminal.press(KEY.escape);
		await sleep(gap);
		await terminal.press("]11;rgb:a/a/a\x07");
		expect(await terminal.lines()).toEqual(opened);
		await terminal.press(KEY.down, KEY.space, KEY.enter);
		expect(await answer).toEqual(["nuxt"]);
	});
});

describe("esc", () => {
	it("still cancels on its own, once the filter has waited to see what follows", async () => {
		const terminal = new Terminal();
		let settled = false;
		const answer = PROMPTS.select(terminal).then((value) => {
			settled = true;
			return value;
		});
		await terminal.press(KEY.escape);
		await sleep(80);
		expect(settled).toBe(false);
		expect(await answer).toBeNull();
	});
});

describe("prompts in a row", () => {
	it("each read their own keys from stdin, piped in again for each", async () => {
		const terminal = new Terminal();
		const picked = PROMPTS.multiselect(terminal);
		await terminal.press(KEY.down, KEY.space, KEY.enter);
		expect(await picked).toEqual(["nuxt"]);
		const managed = PROMPTS.select(terminal);
		await terminal.press(KEY.up, KEY.enter);
		expect(await managed).toBe("macos");
		const confirmed = PROMPTS.confirm(terminal);
		await terminal.press("n");
		expect(await confirmed).toBe(false);
		expect(await terminal.lines()).toEqual([]);
		expect(terminal.input.listenerCount("data")).toBe(0);
	});
});

describe("drawing", () => {
	it("writes the frame, core's closing newline and the erase, and nothing else", async () => {
		const terminal = new Terminal();
		const answer = promptConfirm({ message: "Proceed?" }, terminal.context());
		await terminal.press(KEY.enter);
		await answer;
		expect(terminal.output.text).toBe(
			`${HIDE}\r\x1b[2K ? Proceed?   [Yes]  No\x1b[J\n${SHOW}\r\x1b[1A\x1b[J`,
		);
	});

	it("redraws a frame from its first line, and not for a key that changes nothing", async () => {
		const terminal = new Terminal();
		const answer = promptMultiselect(
			{ message: "Pick", options: CHOICES },
			terminal.context(),
		);
		await terminal.press();
		const first = terminal.output.text.length;
		await terminal.press("x");
		expect(terminal.output.text.length).toBe(first);
		await terminal.press(KEY.space);
		expect(
			terminal.output.text.slice(first).startsWith("\r\x1b[5A\x1b[2K ? Pick"),
		).toBe(true);
		await terminal.press(KEY.escape);
		await answer;
	});

	it("erases a frame that grew while open", async () => {
		const terminal = new Terminal(80, 11);
		terminal.output.write("before\n");
		const many = Array.from({ length: 10 }, (_, index) => ({
			value: index,
			label: `skill-${index}`,
		}));
		const answer = promptSelect(
			{ message: "Pick", options: many },
			terminal.context(),
		);
		await terminal.press();
		const opened = (await terminal.lines()).length;
		await terminal.press(...Array.from({ length: 7 }, () => KEY.down));
		expect((await terminal.lines()).length).toBe(opened + 1);
		await terminal.press(KEY.enter);
		expect(await answer).toBe(7);
		expect(await terminal.lines()).toEqual(["before"]);
	});
});
