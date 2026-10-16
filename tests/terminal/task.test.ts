import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStyle } from "../../src/terminal/style.js";
import { startTask, type TaskHost } from "../../src/terminal/task.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\r\x1b[2K";
const FRAMES = [..."⠁⠂⠄⡀⢀⠠⠐⠈"];
const EVENTS = ["exit", "SIGINT", "SIGTERM"] as const;

class Capture {
	writes: string[] = [];
	write(text: string): void {
		this.writes.push(text);
	}
}

class FakeHost extends EventEmitter implements TaskHost {
	exit = vi.fn();
}

const listening = (host: EventEmitter) =>
	EVENTS.map((event) => host.listenerCount(event));

describe("startTask", () => {
	let out: Capture;
	let host: FakeHost;
	const render = (frame: string) => `${frame} updating`;

	beforeEach(() => {
		vi.useFakeTimers();
		out = new Capture();
		host = new FakeHost();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hides the cursor and draws the first frame at once", () => {
		const task = startTask(out, render, 80, { host });
		expect(out.writes).toEqual([`${HIDE}${CLEAR}⠁ updating`]);
		task.clear();
	});

	it("redraws the line every 80 ms through the frames, round again", () => {
		const task = startTask(out, render, 80, { host });
		vi.advanceTimersByTime(79);
		expect(out.writes).toHaveLength(1);
		vi.advanceTimersByTime(80 * 8 - 79);
		expect(out.writes).toEqual([
			`${HIDE}${CLEAR}⠁ updating`,
			...[...FRAMES.slice(1), "⠁"].map((frame) => `${CLEAR}${frame} updating`),
		]);
		task.clear();
	});

	it("settles into its lines and shows the cursor, and stops spinning", () => {
		const task = startTask(out, render, 80, { host });
		task.settle([" ✓ owner/alpha", "   └─ one"]);
		expect(out.writes.at(-1)).toBe(
			`${CLEAR} ✓ owner/alpha\n   └─ one\n${SHOW}`,
		);
		const written = out.writes.length;
		vi.advanceTimersByTime(800);
		expect(out.writes).toHaveLength(written);
	});

	it("clears its line and shows the cursor", () => {
		const task = startTask(out, render, 80, { host });
		task.clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("finishes once", () => {
		const task = startTask(out, render, 80, { host });
		task.settle(["done"]);
		const written = out.writes.length;
		task.clear();
		task.settle(["again"]);
		expect(out.writes).toHaveLength(written);
	});

	it("adds its exit and signal handlers once, removing them with the last task", () => {
		expect(listening(host)).toEqual([0, 0, 0]);
		const first = startTask(out, render, 80, { host });
		const second = startTask(out, render, 80, { host });
		expect(listening(host)).toEqual([1, 1, 1]);
		first.clear();
		expect(listening(host)).toEqual([1, 1, 1]);
		second.clear();
		expect(listening(host)).toEqual([0, 0, 0]);
	});

	it("erases the line and shows the cursor on exit while a task spins", () => {
		const task = startTask(out, render, 80, { host });
		host.emit("exit");
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
		expect(host.exit).not.toHaveBeenCalled();
		task.clear();
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	])("leaves ○ Cancelled where it spun, shows the cursor on %s and exits %i", (signal, code) => {
		const task = startTask(out, render, 80, { host });
		host.emit(signal);
		expect(out.writes.at(-1)).toBe(`${CLEAR} ○ Cancelled\n${SHOW}`);
		expect(host.exit).toHaveBeenCalledWith(code);
		task.clear();
	});

	it("paints the cancel line a signal leaves dim in the task's style", () => {
		const task = startTask(out, render, 80, {
			host,
			style: createStyle(3),
		});
		host.emit("SIGINT");
		expect(out.writes.at(-1)).toBe(
			`${CLEAR} \x1b[2m○ Cancelled\x1b[22m\n${SHOW}`,
		);
		task.clear();
	});

	it("restores each output still spinning once", () => {
		const other = new Capture();
		const first = startTask(out, render, 80, { host });
		const second = startTask(out, render, 80, { host });
		const third = startTask(other, render, 80, { host });
		out.writes = [];
		host.emit("exit");
		expect(out.writes).toEqual([`${CLEAR}${SHOW}`]);
		expect(other.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
		for (const task of [first, second, third]) {
			task.clear();
		}
	});

	it("keeps the cursor hidden while another task spins on the output", () => {
		const first = startTask(out, render, 80, { host });
		const second = startTask(out, render, 80, { host });
		first.settle(["first"]);
		expect(out.writes.at(-1)).toBe(`${CLEAR}first\n`);
		second.clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("shows the cursor on an output when its own last task ends", () => {
		const other = new Capture();
		const first = startTask(out, render, 80, { host });
		const second = startTask(other, render, 80, { host });
		first.clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
		second.clear();
		expect(other.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("cuts a frame to one line of width - 1, keeping every escape code", () => {
		const task = startTask(
			out,
			(frame) =>
				`\x1b[35m${frame}\x1b[39m \x1b[2mChecking six repositories\x1b[22m\nmore`,
			12,
			{ host },
		);
		expect(out.writes.at(-1)).toBe(
			`${HIDE}${CLEAR}\x1b[35m⠁\x1b[39m \x1b[2mChecking\x1b[22m…`,
		);
		task.clear();
	});

	it("leaves nothing registered or hidden when the first frame throws", () => {
		expect(() =>
			startTask(
				out,
				() => {
					throw new Error("no frame");
				},
				80,
				{ host },
			),
		).toThrow("no frame");
		expect(out.writes).toEqual([]);
		expect(listening(host)).toEqual([0, 0, 0]);
		startTask(out, render, 80, { host }).clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("ends the task and rethrows once when a later frame throws", () => {
		let calls = 0;
		startTask(
			out,
			(frame) => {
				calls += 1;
				if (calls > 1) {
					throw new Error("bad frame");
				}
				return frame;
			},
			80,
			{ host },
		);
		expect(() => vi.advanceTimersByTime(80)).toThrow("bad frame");
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
		expect(listening(host)).toEqual([0, 0, 0]);
		expect(() => vi.advanceTimersByTime(800)).not.toThrow();
		expect(calls).toBe(2);
	});

	it("listens on the process by default", () => {
		const before = listening(process);
		const task = startTask(out, render, 80);
		expect(listening(process)).toEqual(before.map((count) => count + 1));
		task.clear();
		expect(listening(process)).toEqual(before);
	});
});
