import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTask } from "../../src/terminal/task.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\r\x1b[2K";
const FRAMES = [..."⠁⠂⠄⡀⢀⠠⠐⠈"];
const EVENTS = ["exit", "SIGINT", "SIGTERM", "SIGTSTP"] as const;

class Capture {
	writes: string[] = [];
	write(text: string): void {
		this.writes.push(text);
	}
}

const listening = () => EVENTS.map((event) => process.listenerCount(event));

describe("startTask", () => {
	let out: Capture;
	const render = (frame: string) => `${frame} updating`;

	beforeEach(() => {
		vi.useFakeTimers();
		out = new Capture();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hides the cursor and draws the first frame at once", () => {
		const task = startTask(out, render, 80);
		expect(out.writes).toEqual([`${HIDE}${CLEAR}⠁ updating`]);
		task.clear();
	});

	it("redraws the line every 80 ms through the frames, round again", () => {
		const task = startTask(out, render, 80);
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
		const task = startTask(out, render, 80);
		task.settle([" ✓ owner/alpha", "   └─ one"]);
		expect(out.writes.at(-1)).toBe(
			`${CLEAR} ✓ owner/alpha\n   └─ one\n${SHOW}`,
		);
		const written = out.writes.length;
		vi.advanceTimersByTime(800);
		expect(out.writes).toHaveLength(written);
	});

	it("clears its line and shows the cursor", () => {
		const task = startTask(out, render, 80);
		task.clear();
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
	});

	it("finishes once", () => {
		const task = startTask(out, render, 80);
		task.settle(["done"]);
		const written = out.writes.length;
		task.clear();
		task.settle(["again"]);
		expect(out.writes).toHaveLength(written);
	});

	it("cuts a frame to one line of width - 1, keeping every escape code", () => {
		const task = startTask(
			out,
			(frame) =>
				`\x1b[35m${frame}\x1b[39m \x1b[2mChecking six repositories\x1b[22m\nmore`,
			12,
		);
		expect(out.writes.at(-1)).toBe(
			`${HIDE}${CLEAR}\x1b[35m⠁\x1b[39m \x1b[2mChecking\x1b[22m…`,
		);
		task.clear();
	});

	it("leaves nothing hidden when the first frame throws", () => {
		expect(() =>
			startTask(
				out,
				() => {
					throw new Error("no frame");
				},
				80,
			),
		).toThrow("no frame");
		expect(out.writes).toEqual([]);
		startTask(out, render, 80).clear();
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
		);
		expect(() => vi.advanceTimersByTime(80)).toThrow("bad frame");
		expect(out.writes.at(-1)).toBe(`${CLEAR}${SHOW}`);
		expect(() => vi.advanceTimersByTime(800)).not.toThrow();
		expect(calls).toBe(2);
	});

	it("leaves the process's exit and signals to the run", () => {
		const before = listening();
		const task = startTask(out, render, 80);
		expect(listening()).toEqual(before);
		task.clear();
	});
});
