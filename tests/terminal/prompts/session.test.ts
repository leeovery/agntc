import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { promptConfirm } from "../../../src/terminal/prompts/confirm.js";
import { Engine } from "../../../src/terminal/prompts/engine.js";
import { promptMultiselect } from "../../../src/terminal/prompts/multiselect.js";
import { promptSelect } from "../../../src/terminal/prompts/select.js";
import {
	noFrame,
	type PromptStreams,
	runPrompt,
} from "../../../src/terminal/prompts/session.js";
import { createStyle } from "../../../src/terminal/style.js";
import {
	CaptureStdout,
	FakeHost,
	FakeStdin,
	KEY,
	Terminal,
} from "./terminal.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const EXIT_EVENTS = ["exit", "SIGINT", "SIGTERM"] as const;
/** The process's signals of a suspend: the prompt's SIGTSTP, and the SIGCONT readline would leave, suspending by itself. */
const SIGNALS = ["SIGTSTP", "SIGCONT"] as const;

const signalListeners = () =>
	SIGNALS.map((signal) => process.listenerCount(signal));

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
/** What each prompt answers when cancelled. */
const CANCELLED = { select: null, multiselect: [], confirm: false };

const listening = (terminal: Terminal) =>
	EXIT_EVENTS.map((event) => terminal.host.listenerCount(event));

const cursorShown = (text = "") =>
	text.lastIndexOf(SHOW) > text.lastIndexOf(HIDE);

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
		await terminal.press();
		expect((await terminal.lines()).length).toBeGreaterThan(1);
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

	it("unpipes stdin as it answers, before a prompt after it can pipe it again", async () => {
		const terminal = new Terminal();
		let piped: number | undefined;
		const answer = ask(terminal).then(() => {
			piped = terminal.input.listenerCount("data");
		});
		await terminal.press(KEY.enter);
		await answer;
		expect(piped).toBe(0);
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

	it.each<[string, (terminal: Terminal) => Promise<void>]>([
		[
			"ctrl-d after an arrow",
			(terminal) => terminal.press(KEY.down, KEY.ctrlD),
		],
		// Readline keeps these in its line, and then reads ctrl-d as delete-right.
		[
			"ctrl-d after keys readline keeps",
			(terminal) => terminal.press(KEY.space, "j", KEY.tab, KEY.ctrlD),
		],
		[
			"stdin's end, on which readline closes",
			(terminal) => {
				terminal.input.end();
				return terminal.press();
			},
		],
	])("cancels on %s, leaving nothing on the screen and the terminal as it was", async (_on, end) => {
		const terminal = new Terminal();
		const watching = signalListeners();
		terminal.output.write("before\n");
		const answer = ask(terminal);
		await terminal.press();
		await end(terminal);
		expect(await answer).toEqual(CANCELLED[name]);
		expect(await terminal.lines()).toEqual(["before"]);
		expect(await terminal.cursor()).toEqual([0, 1]);
		expect(cursorShown(terminal.output.text)).toBe(true);
		expect(terminal.input.isRaw).toBe(false);
		expect(listening(terminal)).toEqual([0, 0, 0]);
		expect(signalListeners()).toEqual(watching);
		expect(terminal.input.listenerCount("data")).toBe(0);
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

describe("on a fake clock", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// Read as keys, its a's would pick everything, and its ESC as escape would
	// cancel. Split by readline's 50 ms or more, the ESC is the escape key, as
	// it is without the filter.
	it.each([
		3, 49,
	])("reads a terminal's reply split after its ESC, the rest %i ms on, as no keys", async (gap) => {
		const terminal = new Terminal();
		const answer = PROMPTS.multiselect(terminal);
		await terminal.press(KEY.escape);
		vi.advanceTimersByTime(gap);
		await terminal.press("]11;rgb:a/a/a\x07", KEY.down, KEY.space, KEY.enter);
		expect(await answer).toEqual(["nuxt"]);
	});

	it("cancels on esc alone once readline's 50 ms go by, the filter's wait in them", async () => {
		const terminal = new Terminal();
		let settled = false;
		const answer = PROMPTS.select(terminal).then((value) => {
			settled = true;
			return value;
		});
		await terminal.press(KEY.escape);
		vi.advanceTimersByTime(49);
		await terminal.press();
		expect(settled).toBe(false);
		vi.advanceTimersByTime(1);
		await terminal.press();
		expect(settled).toBe(true);
		expect(await answer).toBeNull();
	});

	it("leaves no wait behind once answered, an ESC held as it ends", async () => {
		const input = new FakeStdin();
		const answer = promptSelect(
			{ message: "Pick", options: CHOICES },
			{
				input,
				output: new CaptureStdout(),
				width: 80,
				style: createStyle(0),
				background: [0, 0, 0],
				host: new FakeHost(),
			},
		);
		input.write("\r\x1b");
		expect(await answer).toBe("laravel");
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("ctrl-z", () => {
	const SUSPEND = "\x1a";
	let terminal: Terminal;
	/** The engine of a prompt run here on runPrompt, to be seen at the stop. */
	let engine: Engine | undefined;
	/** Each `process.kill`, kept here from the test worker, with the terminal as it stood. */
	let kills: {
		pid: number;
		signal: unknown;
		text: string;
		raw: boolean;
		catching: number;
		asking: boolean | undefined;
	}[];
	let kill: MockInstance<typeof process.kill>;
	/** The SIGTSTP and SIGCONT listeners before the prompt, the counts it must leave. */
	let watching: number[];

	beforeEach(() => {
		terminal = new Terminal();
		engine = undefined;
		kills = [];
		watching = signalListeners();
		// Returning at once, as for a job continued straight away.
		kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			kills.push({
				pid,
				signal,
				text: terminal.output.text,
				raw: terminal.input.isRaw,
				catching: process.listenerCount("SIGTSTP"),
				asking: engine?.asking,
			});
			return true;
		});
	});

	afterEach(() => {
		kill.mockRestore();
	});

	async function screenOf(text = ""): Promise<string[]> {
		const screen = new Terminal();
		screen.output.write(text);
		return screen.lines();
	}

	/** The whole process group stopped, the frame erased, the cursor shown and cooked mode, the prompt's own SIGTSTP listener off so the signal stops the process. */
	async function expectStoppedForTheShell(
		stop: (typeof kills)[number] | undefined,
	) {
		expect([stop?.pid, stop?.signal]).toEqual([0, "SIGTSTP"]);
		expect(stop?.catching).toBe(watching[0]);
		expect(stop?.raw).toBe(false);
		expect(cursorShown(stop?.text)).toBe(true);
		expect(await screenOf(stop?.text)).toEqual(["before"]);
	}

	function pick(): Promise<Engine> {
		return runPrompt(
			terminal.context(),
			(streams) => {
				engine = new Engine({ ...streams, render: noFrame });
				return engine;
			},
			() => [" ? Pick"],
		);
	}

	it("stops the whole process group, leaving the shell the cursor and cooked mode, and comes back as it was", async () => {
		terminal.output.write("before\n");
		const answer = PROMPTS.select(terminal);
		await terminal.press(KEY.down);
		const drawn = await terminal.lines();
		await terminal.press(SUSPEND);
		expect(kills).toHaveLength(1);
		await expectStoppedForTheShell(kills[0]);
		expect(signalListeners()).toEqual([(watching[0] ?? 0) + 1, watching[1]]);
		expect(terminal.input.isRaw).toBe(true);
		expect(cursorShown(terminal.output.text)).toBe(false);
		expect(await terminal.lines()).toEqual(drawn);
		await terminal.press(KEY.down, KEY.enter);
		expect(await answer).toBe("macos");
		expect(signalListeners()).toEqual(watching);
	});

	it("stops before a key read with its ctrl-z answers, and leaves no listener once answered", async () => {
		terminal.output.write("before\n");
		const asked = pick();
		await terminal.press(`${SUSPEND}\r`);
		expect((await asked).state).toBe("submit");
		expect(kills.map(({ asking }) => asking)).toEqual([true]);
		await expectStoppedForTheShell(kills[0]);
		expect(signalListeners()).toEqual(watching);
		expect(terminal.input.isRaw).toBe(false);
		expect(await terminal.lines()).toEqual(["before"]);
	});

	it("stops once for each ctrl-z in a read, coming back after each", async () => {
		terminal.output.write("before\n");
		const answer = PROMPTS.select(terminal);
		await terminal.press(KEY.down);
		const drawn = await terminal.lines();
		await terminal.press(`${SUSPEND}${SUSPEND}`);
		expect(kills).toHaveLength(2);
		await expectStoppedForTheShell(kills[0]);
		await expectStoppedForTheShell(kills[1]);
		expect(await terminal.lines()).toEqual(drawn);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("nuxt");
		expect(signalListeners()).toEqual(watching);
	});

	it("takes a SIGTSTP sent from outside as it takes ctrl-z", async () => {
		terminal.output.write("before\n");
		const answer = PROMPTS.select(terminal);
		await terminal.press(KEY.down);
		const drawn = await terminal.lines();
		process.emit("SIGTSTP");
		expect(kills).toHaveLength(1);
		await expectStoppedForTheShell(kills[0]);
		expect(terminal.input.isRaw).toBe(true);
		expect(cursorShown(terminal.output.text)).toBe(false);
		expect(await terminal.lines()).toEqual(drawn);
		await terminal.press(KEY.enter);
		expect(await answer).toBe("nuxt");
		expect(signalListeners()).toEqual(watching);
	});
});

describe("a list on a screen with little room", () => {
	it.each([
		["select", 3],
		["select", 4],
		["select", 5],
		["multiselect", 3],
		["multiselect", 4],
		["multiselect", 5],
		["multiselect", 6],
	] as const)("erases itself whole at the foot of it, a %s at %i rows", async (name, rows) => {
		const above = Array.from(
			{ length: rows - 1 },
			(_, index) => `line ${index + 1}`,
		);
		for (const downs of [0, 1, 2]) {
			const terminal = new Terminal(80, rows);
			terminal.output.write(above.map((line) => `${line}\n`).join(""));
			const answer = PROMPTS[name](terminal);
			await terminal.press(
				...Array.from({ length: downs }, () => KEY.down),
				KEY.space,
				KEY.enter,
			);
			await answer;
			terminal.output.write("after\n");
			expect(await terminal.lines()).toEqual([...above, "after"]);
		}
	});
});

describe("a throw while a prompt opens", () => {
	class Unopenable extends Engine {
		override prompt(): Promise<string | symbol> {
			throw new Error("can't open");
		}
	}

	const plain = (streams: PromptStreams) =>
		new Engine({ ...streams, render: noFrame });

	it.each([
		[
			"the opening",
			(): Engine => {
				throw new Error("can't open");
			},
			() => [" ? Pick"],
		],
		[
			"its engine",
			(streams: PromptStreams) =>
				new Unopenable({ ...streams, render: noFrame }),
			() => [" ? Pick"],
		],
		[
			"its first frame",
			plain,
			() => {
				throw new Error("can't draw");
			},
		],
	])("closes the engine and restores the terminal before it reaches the caller, thrown by %s", async (_by, open, frame) => {
		const terminal = new Terminal();
		const watching = signalListeners();
		terminal.output.write("before\n");
		const asked = runPrompt(terminal.context(), open, frame);
		await expect(asked).rejects.toThrow(/^can't/);
		expect(await terminal.lines()).toEqual(["before"]);
		expect(await terminal.cursor()).toEqual([0, 1]);
		expect(terminal.output.text.endsWith(SHOW)).toBe(true);
		expect(terminal.input.rawModes.at(-1)).toBe(false);
		expect(terminal.output.listenerCount("resize")).toBe(0);
		expect(listening(terminal)).toEqual([0, 0, 0]);
		expect(signalListeners()).toEqual(watching);
		expect(terminal.input.listenerCount("data")).toBe(0);
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
		await terminal.press();
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
