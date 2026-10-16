import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		const task = startTask(out, render, { host });
		expect(out.writes).toEqual([HIDE, `${CLEAR}⠁ updating`]);
		task.clear();
	});

	it("redraws the line every 80 ms through the frames, round again", () => {
		const task = startTask(out, render, { host });
		vi.advanceTimersByTime(79);
		expect(out.writes).toHaveLength(2);
		vi.advanceTimersByTime(80 * 8 - 79);
		expect(out.writes.slice(1)).toEqual(
			[...FRAMES, "⠁"].map((frame) => `${CLEAR}${frame} updating`),
		);
		task.clear();
	});

	it("settles into its lines and shows the cursor, and stops spinning", () => {
		const task = startTask(out, render, { host });
		task.settle([" ✓ owner/alpha", "   └─ one"]);
		expect(out.writes.at(-1)).toBe(
			`${CLEAR} ✓ owner/alpha\n   └─ one\n${SHOW}`,
		);
		const written = out.writes.length;
		vi.advanceTimersByTime(800);
		expect(out.writes).toHaveLength(written);
	});

	it("clears its line and shows the cursor", () => {
		const task = startTask(out, render, { host });
		task.clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("finishes once", () => {
		const task = startTask(out, render, { host });
		task.settle(["done"]);
		const written = out.writes.length;
		task.clear();
		task.settle(["again"]);
		expect(out.writes).toHaveLength(written);
	});

	it("adds its exit and signal handlers once, removing them with the last task", () => {
		expect(listening(host)).toEqual([0, 0, 0]);
		const first = startTask(out, render, { host });
		const second = startTask(out, render, { host });
		expect(listening(host)).toEqual([1, 1, 1]);
		first.clear();
		expect(listening(host)).toEqual([1, 1, 1]);
		second.clear();
		expect(listening(host)).toEqual([0, 0, 0]);
	});

	it("shows the cursor on exit while a task spins", () => {
		const task = startTask(out, render, { host });
		host.emit("exit");
		expect(out.writes.at(-1)).toBe(SHOW);
		expect(host.exit).not.toHaveBeenCalled();
		task.clear();
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	])("shows the cursor on %s and exits %i", (signal, code) => {
		const task = startTask(out, render, { host });
		host.emit(signal);
		expect(out.writes.at(-1)).toBe(SHOW);
		expect(host.exit).toHaveBeenCalledWith(code);
		task.clear();
	});

	it("shows the cursor once on each output still spinning", () => {
		const other = new Capture();
		const first = startTask(out, render, { host });
		const second = startTask(out, render, { host });
		const third = startTask(other, render, { host });
		out.writes = [];
		host.emit("exit");
		expect(out.writes).toEqual([SHOW]);
		expect(other.writes.at(-1)).toBe(SHOW);
		for (const task of [first, second, third]) {
			task.clear();
		}
	});

	it("listens on the process by default", () => {
		const before = listening(process);
		const task = startTask(out, render);
		expect(listening(process)).toEqual(before.map((count) => count + 1));
		task.clear();
		expect(listening(process)).toEqual(before);
	});
});
