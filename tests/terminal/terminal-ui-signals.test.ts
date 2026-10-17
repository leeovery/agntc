import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import type { Header, NextItem, Row } from "../../src/terminal/types.js";
import { KEY, Terminal } from "./prompts/terminal.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\r\x1b[2K";
const DIM = "\x1b[2m";
const NORMAL = "\x1b[22m";
const SUSPEND = "\x1a";
const EVENTS = ["exit", "SIGINT", "SIGTERM", "SIGTSTP"] as const;

const HEADER: Header = { command: "update", where: "~/project", version: "1" };
const REMOVE = "npx agntc remove o/r/laravel";
const READD = "npx agntc add o/r --skill laravel";
const ABORT: NextItem = {
	subject: "laravel",
	remedy: {
		lead: "To update it anyway:",
		steps: [{ command: REMOVE }, { command: READD }],
	},
};
const NEXT_LINES = [
	"",
	" Next",
	"   laravel — to update it anyway:",
	`     ${REMOVE}`,
	`     ${READD}`,
];
const CANCELLED = ["", " ○ Cancelled"];

const SUBJECTS = [{ subject: "owner/alpha" }, { subject: "owner/beta" }];
const ALPHA: Row = { status: "done", subject: "owner/alpha" };
const BETA: Row = { status: "done", subject: "owner/beta" };
const PROGRESS = { subject: "owner/beta", text: "updating…" };

/** What the terminal held, and how it stood, as the run stopped or exited. */
interface Moment {
	text: string;
	raw: boolean;
	listening: number[];
}

function run(options: { env?: Record<string, string>; header?: Header } = {}) {
	const term = new Terminal(80, 40);
	const ui = new TerminalUi({
		header: options.header,
		input: term.input,
		output: term.output,
		env: options.env ?? {},
		host: term.host,
	});
	const moment = (): Moment => ({
		text: term.output.text,
		raw: term.input.isRaw,
		listening: EVENTS.map((event) => term.host.listenerCount(event)),
	});
	const exits: (Moment & { code: number })[] = [];
	term.host.exit.mockImplementation((code: number) => {
		exits.push({ code, ...moment() });
	});
	const stops: Moment[] = [];
	term.host.kill.mockImplementation(() => {
		stops.push(moment());
	});
	ui.begin();
	return { term, ui, exits, stops, moment };
}

async function screenOf(text: string): Promise<string[]> {
	const screen = new Terminal(80, 40);
	screen.output.write(text);
	return screen.lines();
}

const cursorShown = (text: string) =>
	text.lastIndexOf(SHOW) >= text.lastIndexOf(HIDE);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
	vi.useRealTimers();
});

describe.each([
	["SIGINT", 130],
	["SIGTERM", 143],
] as const)("a %s", (signal, code) => {
	/** The run exited once, with the signal's code, its terminal given back: cooked, the cursor shown, nothing listening. */
	function expectExited(exits: (Moment & { code: number })[], text: string) {
		expect(exits).toHaveLength(1);
		const [exit] = exits;
		expect(exit?.code).toBe(code);
		expect(exit?.text).toBe(text);
		expect(exit?.raw).toBe(false);
		expect(cursorShown(exit?.text ?? "")).toBe(true);
		expect(exit?.listening).toEqual([0, 0, 0, 0]);
	}

	it("under a spinner clears it, prints what it held, the Next items, then ○ Cancelled, and exits", async () => {
		const { term, ui, exits } = run();
		ui.warn("alpha can't be updated");
		ui.next(ABORT);
		ui.block(SUBJECTS).task(PROGRESS);
		ui.note("held under the spinner");

		term.host.emit(signal);

		expect(await term.lines()).toEqual([
			" ! alpha can't be updated",
			"",
			" · held under the spinner",
			...NEXT_LINES,
			...CANCELLED,
		]);
		expectExited(exits, term.output.text);
		const written = term.output.text;
		vi.advanceTimersByTime(800);
		expect(term.output.text).toBe(written);
	});

	it("at a prompt erases it, prints what was said while it asked, the Next items, then ○ Cancelled, and exits", async () => {
		const { term, ui, exits } = run();
		ui.next(ABORT);
		const block = ui.block(SUBJECTS);
		block.row(ALPHA);
		const task = block.task(PROGRESS);
		const answer = ui.confirm({ message: "Remove it?" });
		await term.press();
		expect((await term.lines()).join("\n")).toContain("Remove it?");
		task.settle(BETA);

		term.host.emit(signal);

		expect(await term.lines()).toEqual([
			" ✓ owner/alpha",
			" ✓ owner/beta",
			...NEXT_LINES,
			...CANCELLED,
		]);
		expectExited(exits, term.output.text);
		await term.press(KEY.escape);
		await answer;
	});

	it("between steps prints the Next items, then ○ Cancelled, and exits", async () => {
		const { term, ui, exits } = run();
		ui.block(SUBJECTS).row(ALPHA);
		ui.next(ABORT);

		term.host.emit(signal);

		expect(await term.lines()).toEqual([
			" ✓ owner/alpha",
			...NEXT_LINES,
			...CANCELLED,
		]);
		expectExited(exits, term.output.text);
	});

	it("with nothing queued prints ○ Cancelled alone, a blank line over it, and no rule or tally", async () => {
		const { term, ui, exits } = run();
		ui.block(SUBJECTS).row(ALPHA);

		term.host.emit(signal);

		expect(await term.lines()).toEqual([" ✓ owner/alpha", ...CANCELLED]);
		expectExited(exits, term.output.text);
	});

	it("under the header takes its blank line for its own", async () => {
		const { term, ui } = run({ header: HEADER });
		ui.header();

		term.host.emit(signal);

		const lines = await term.lines();
		expect(lines.slice(1)).toEqual(CANCELLED);
	});

	it("paints ○ Cancelled dim", () => {
		const { term } = run({ env: { FORCE_COLOR: "3" } });

		term.host.emit(signal);

		expect(term.output.text).toBe(` ${DIM}○ Cancelled${NORMAL}\n`);
	});

	it("once the run has ended is the process's own", () => {
		const { term, ui, exits } = run();
		ui.end();
		expect(term.host.listenerCount(signal)).toBe(0);
		term.host.emit(signal);
		expect(exits).toEqual([]);
	});
});

describe("a SIGTSTP", () => {
	it("under a spinner clears its line and shows the cursor, stops the process group, then spins again", async () => {
		const { term, ui, stops } = run();
		ui.block(SUBJECTS).task(PROGRESS);
		vi.advanceTimersByTime(80);

		term.host.emit("SIGTSTP");

		expect(term.host.kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
		const [stop] = stops;
		expect(stop?.text.endsWith(`${CLEAR}${SHOW}`)).toBe(true);
		expect(await screenOf(stop?.text ?? "")).toEqual([]);
		expect(stop?.listening).toEqual([1, 1, 1, 0]);
		const after = term.output.text.slice(stop?.text.length);
		expect(after.startsWith(`${HIDE}${CLEAR}`)).toBe(true);
		expect(await term.lines()).toEqual([" ⠁ owner/beta    updating…"]);
		vi.advanceTimersByTime(80);
		expect(await term.lines()).toEqual([" ⠂ owner/beta    updating…"]);
		expect(term.host.listenerCount("SIGTSTP")).toBe(1);
		ui.end();
	});

	it("between steps stops the process group, the cursor shown", () => {
		const { term, stops } = run();

		term.host.emit("SIGTSTP");

		expect(term.host.kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
		expect(cursorShown(stops[0]?.text ?? "")).toBe(true);
	});

	it("after a prompt is answered leaves it gone, and the terminal cooked", async () => {
		const { term, ui } = run();
		ui.note("before");
		const answer = ui.confirm({ message: "Remove it?" });
		await term.press("y");
		expect(await answer).toBe(true);
		const written = term.output.text;

		term.host.emit("SIGTSTP");

		expect(term.host.kill).toHaveBeenCalledOnce();
		expect(term.output.text).toBe(written);
		expect(term.input.isRaw).toBe(false);
	});

	describe("at a prompt", () => {
		/** The whole process group stopped with the frame erased, the cursor shown, cooked mode and SIGTSTP let go. */
		async function expectStoppedForTheShell(stop: Moment | undefined) {
			expect(stop?.raw).toBe(false);
			expect(cursorShown(stop?.text ?? "")).toBe(true);
			expect(stop?.listening).toEqual([1, 1, 1, 0]);
			expect(await screenOf(stop?.text ?? "")).toEqual([" · before"]);
		}

		const ask = (ui: TerminalUi) =>
			ui.select({
				message: "Pick",
				options: [
					{ value: "laravel", label: "laravel" },
					{ value: "nuxt", label: "nuxt" },
					{ value: "macos", label: "macos" },
				],
			});

		it.each<[string, (term: Terminal) => Promise<void> | boolean]>([
			["ctrl-z", (term) => term.press(SUSPEND)],
			["a SIGTSTP from outside", (term) => term.host.emit("SIGTSTP")],
		])("on %s erases it and leaves the terminal cooked, stops the process group, and comes back as it was", async (_on, suspend) => {
			const { term, ui, stops } = run();
			ui.note("before");
			const answer = ask(ui);
			await term.press(KEY.down);
			const drawn = await term.lines();

			await suspend(term);

			expect(term.host.kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
			await expectStoppedForTheShell(stops[0]);
			expect(term.input.isRaw).toBe(true);
			expect(cursorShown(term.output.text)).toBe(false);
			expect(await term.lines()).toEqual(drawn);
			await term.press(KEY.down, KEY.enter);
			expect(await answer).toBe("macos");
		});

		it("stops once for each ctrl-z in a read, coming back after each", async () => {
			const { term, ui, stops } = run();
			ui.note("before");
			const answer = ask(ui);
			await term.press(KEY.down);
			const drawn = await term.lines();

			await term.press(`${SUSPEND}${SUSPEND}`);

			expect(stops).toHaveLength(2);
			await expectStoppedForTheShell(stops[0]);
			await expectStoppedForTheShell(stops[1]);
			expect(await term.lines()).toEqual(drawn);
			await term.press(KEY.enter);
			expect(await answer).toBe("nuxt");
		});

		it("stops before a key read with its ctrl-z answers", async () => {
			const { term, ui, stops } = run();
			ui.note("before");
			const answer = ask(ui);
			await term.press();

			await term.press(`${SUSPEND}\r`);

			expect(await answer).toBe("laravel");
			expect(stops).toHaveLength(1);
			await expectStoppedForTheShell(stops[0]);
			expect(term.input.isRaw).toBe(false);
			expect(await term.lines()).toEqual([" · before"]);
		});
	});
});

describe("the process exiting", () => {
	it("under a spinner clears its line and shows the cursor, and nothing more", async () => {
		const { term, ui, exits } = run();
		ui.next(ABORT);
		ui.block(SUBJECTS).task(PROGRESS);

		term.host.emit("exit");

		expect(term.output.text).toContain(`${CLEAR}${SHOW}`);
		expect(cursorShown(term.output.text)).toBe(true);
		expect(await term.lines()).toEqual([]);
		expect(exits).toEqual([]);
		ui.end();
	});

	it("at a prompt erases it, ends raw mode and shows the cursor", async () => {
		const { term, ui } = run();
		const answer = ui.confirm({ message: "Remove it?" });
		await term.press();

		term.host.emit("exit");

		expect(await term.lines()).toEqual([]);
		expect(term.input.isRaw).toBe(false);
		expect(term.output.text.endsWith(SHOW)).toBe(true);
		await term.press(KEY.escape);
		await answer;
	});
});

describe("the run's signals", () => {
	it("are watched from begin to end, once each", () => {
		const { term, ui } = run();
		ui.begin();
		expect(EVENTS.map((event) => term.host.listenerCount(event))).toEqual([
			1, 1, 1, 1,
		]);
		ui.end();
		expect(EVENTS.map((event) => term.host.listenerCount(event))).toEqual([
			0, 0, 0, 0,
		]);
	});
});
