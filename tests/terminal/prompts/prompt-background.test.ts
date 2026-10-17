import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_QUERY } from "../../../src/terminal/prompts/background.js";
import { createStyle } from "../../../src/terminal/style.js";
import { KEY, Terminal, tick } from "./terminal.js";

// The background is asked once per process, so each test loads the prompts
// afresh, as a new process would.

const DARK_REPLY = "\x1b]11;rgb:1e1e/1e1e/1e1e\x07";
const BAND = "\x1b[48;2;60;54;78m";
const truecolor = createStyle(3);

const CHOICES = [
	{ value: "laravel", label: "laravel" },
	{ value: "nuxt", label: "nuxt" },
	{ value: "macos", label: "macos" },
];

async function freshPrompts() {
	vi.resetModules();
	const [select, multiselect] = await Promise.all([
		import("../../../src/terminal/prompts/select.js"),
		import("../../../src/terminal/prompts/multiselect.js"),
	]);
	return { ...select, ...multiselect };
}

function terminalAnswering(reply?: string | string[]): Terminal {
	const terminal = new Terminal();
	terminal.output.isTTY = true;
	terminal.backgroundReply = reply;
	return terminal;
}

const queries = (terminal: Terminal) =>
	terminal.output.text.split(BACKGROUND_QUERY).length - 1;

/** Past the 150 ms the terminal has to answer, in real time: the screen runs on timers too. */
const givenUp = () => sleep(160);

describe("the background", () => {
	it("is asked for when the first prompt opens, before it draws, and bands the cursor row", async () => {
		const { promptSelect } = await freshPrompts();
		const terminal = terminalAnswering(DARK_REPLY);
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			terminal.context(truecolor),
		);
		await sleep(20);
		const { text } = terminal.output;
		expect(text.startsWith(BACKGROUND_QUERY)).toBe(true);
		expect(text).toContain(`${BAND} \x1b[1mlaravel\x1b[22m`);
		await terminal.press(KEY.down, KEY.enter);
		expect(await answer).toBe("nuxt");
	});

	it("is asked once per process, every prompt after sharing its answer", async () => {
		const { promptSelect, promptMultiselect } = await freshPrompts();
		const first = terminalAnswering(DARK_REPLY);
		const picked = promptMultiselect(
			{ message: "Pick", options: CHOICES },
			first.context(truecolor),
		);
		await first.press(KEY.enter);
		await picked;
		const second = terminalAnswering(DARK_REPLY);
		const managed = promptSelect(
			{ message: "Manage", options: CHOICES },
			second.context(truecolor),
		);
		await second.press();
		expect([queries(first), queries(second)]).toEqual([1, 0]);
		expect(second.output.text).toContain(BAND);
		await second.press(KEY.enter);
		await managed;
	});

	it("leaves the band off when the terminal doesn't answer in 150 ms", async () => {
		const { promptSelect } = await freshPrompts();
		const terminal = terminalAnswering();
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			terminal.context(truecolor),
		);
		await terminal.press();
		expect(await terminal.lines()).toEqual([]);
		await givenUp();
		expect((await terminal.lines())[1]).toBe(" ▌ laravel");
		expect(terminal.output.text).not.toContain("\x1b[48;");
		await terminal.press(KEY.enter);
		await answer;
	});

	it("takes its colour from an answer split after its ESC, never reading it as keys", async () => {
		const { promptMultiselect } = await freshPrompts();
		// Read as keys, its three a's would pick everything.
		const terminal = terminalAnswering(["\x1b", "]11;rgb:a/a/a\x07"]);
		const answer = promptMultiselect(
			{ message: "Pick", options: CHOICES },
			terminal.context(truecolor),
		);
		await sleep(20);
		expect(terminal.output.text).toContain("\x1b[48;2;169;163;188m");
		expect((await terminal.lines()).at(-1)?.trim()).toBe("0 of 3 picked");
		await terminal.press(KEY.enter);
		expect(await answer).toEqual([]);
	});

	it("swallows an answer that comes too late, never reading it as keys", async () => {
		const { promptMultiselect } = await freshPrompts();
		const terminal = terminalAnswering();
		const answer = promptMultiselect(
			{ message: "Pick", options: CHOICES },
			terminal.context(truecolor),
		);
		await givenUp();
		const opened = await terminal.lines();
		// Read as keys, its three a's would pick everything, and its ESC
		// would be the start of a key.
		await terminal.press("\x1b]11;rgb:a/a/a\x07");
		expect(await terminal.lines()).toEqual(opened);
		await terminal.press(KEY.down, KEY.space, KEY.enter);
		expect(await answer).toEqual(["nuxt"]);
	});

	it("reads a key pressed while it's asked, the first frame showing it", async () => {
		const { promptSelect } = await freshPrompts();
		const terminal = terminalAnswering();
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			terminal.context(truecolor),
		);
		await terminal.press(KEY.down);
		await givenUp();
		expect((await terminal.lines())[2]).toBe(" ▌ nuxt");
		await terminal.press(KEY.enter);
		expect(await answer).toBe("nuxt");
	});

	describe("on a fake clock", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		const elapse = async (ms: number) => {
			vi.advanceTimersByTime(ms);
			await tick();
		};

		it("reads an esc pressed while it's asked as the escape key, not the start of the key after it", async () => {
			const { promptSelect } = await freshPrompts();
			const terminal = terminalAnswering();
			const answer = promptSelect(
				{ message: "Pick", options: CHOICES },
				terminal.context(createStyle(2)),
			);
			await elapse(10);
			await terminal.press(KEY.escape);
			await elapse(90);
			await terminal.press("j");
			await elapse(300);
			await terminal.press(KEY.enter);
			expect(await answer).toBeNull();
		});

		it("answers a key typed while it's asked only once the reply is in, raw mode on for it", async () => {
			const { promptSelect } = await freshPrompts();
			const terminal = terminalAnswering();
			const answer = promptSelect(
				{ message: "Pick", options: CHOICES },
				terminal.context(truecolor),
			);
			await elapse(5);
			await terminal.press(KEY.enter);
			await elapse(35);
			const rawForTheReply = terminal.input.isRaw;
			await terminal.press(DARK_REPLY);
			expect(await answer).toBe("laravel");
			expect(rawForTheReply).toBe(true);
			expect(terminal.output.text).toContain(BAND);
			expect(terminal.input.isRaw).toBe(false);
		});

		it("takes out the reply before a ctrl-z typed while it's asked suspends", async () => {
			let banded: boolean | undefined;
			const kill = vi.spyOn(process, "kill").mockImplementation(() => {
				banded = terminal.output.text.includes(BAND);
				return true;
			});
			const terminal = terminalAnswering();
			try {
				const { promptSelect } = await freshPrompts();
				const answer = promptSelect(
					{ message: "Pick", options: CHOICES },
					terminal.context(truecolor),
				);
				await elapse(5);
				await terminal.press("\x1a");
				await elapse(25);
				expect(kill).not.toHaveBeenCalled();
				await terminal.press(DARK_REPLY);
				expect(kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
				expect(banded).toBe(true);
				await terminal.press(KEY.enter);
				expect(await answer).toBe("laravel");
			} finally {
				kill.mockRestore();
			}
		});

		it("cancels on a ctrl-d typed while it's asked, once the reply is in", async () => {
			const { promptSelect } = await freshPrompts();
			const terminal = terminalAnswering();
			const answer = promptSelect(
				{ message: "Pick", options: CHOICES },
				terminal.context(truecolor),
			);
			await elapse(5);
			await terminal.press(KEY.ctrlD);
			await elapse(35);
			await terminal.press(DARK_REPLY);
			expect(await answer).toBeNull();
			expect(terminal.output.text).toContain(BAND);
			expect(terminal.input.isRaw).toBe(false);
			// Read again on the real clock, as xterm writes on timers.
			vi.useRealTimers();
			const screen = new Terminal();
			screen.output.write(terminal.output.text);
			expect(await screen.lines()).toEqual([]);
		});
	});

	it("isn't asked for below 256 colours, and nothing is banded", async () => {
		const { promptSelect } = await freshPrompts();
		const terminal = terminalAnswering(DARK_REPLY);
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			terminal.context(createStyle(1)),
		);
		await terminal.press(KEY.enter);
		await answer;
		expect(queries(terminal)).toBe(0);
		expect(terminal.output.text).not.toContain("\x1b[48;");
	});

	it("isn't asked for when it's already known", async () => {
		const { promptSelect } = await freshPrompts();
		const terminal = terminalAnswering(DARK_REPLY);
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			{ ...terminal.context(truecolor), background: [255, 255, 255] },
		);
		await terminal.press(KEY.enter);
		await answer;
		expect(queries(terminal)).toBe(0);
		expect(terminal.output.text).toContain("\x1b[48;2;236;229;254m");
	});
});
