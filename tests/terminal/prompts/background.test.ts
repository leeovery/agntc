import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BACKGROUND_QUERY,
	parseBackground,
	queryBackground,
} from "../../../src/terminal/prompts/background.js";
import { InputFilter } from "../../../src/terminal/prompts/input-filter.js";
import { bandPainter } from "../../../src/terminal/style.js";
import { CaptureStdout, FakeStdin, tick } from "./terminal.js";

describe("parseBackground", () => {
	it.each([
		["four digits a channel", "11;rgb:1e1e/1e1e/1e1e", [30, 30, 30]],
		["two", "11;rgb:ff/80/00", [255, 128, 0]],
		["one", "11;rgb:f/0/8", [255, 0, 136]],
		["three", "11;rgb:fff/000/800", [255, 0, 128]],
		["upper-case hex", "11;rgb:FFFF/0000/8080", [255, 0, 128]],
		["channels of different lengths", "11;rgb:ffff/0/80", [255, 0, 128]],
	])("reads %s, scaled to 8 bits", (_name, body, colour) => {
		expect(parseBackground(body)).toEqual(colour);
	});

	it.each([
		["no colour", "11;?"],
		["a missing channel", "11;rgb:ffff/ffff"],
		["five digits", "11;rgb:fffff/0/0"],
		["no digits", "11;rgb://"],
		["what isn't hex", "11;rgb:zzzz/0/0"],
		["rgba", "11;rgba:ffff/ffff/ffff/ffff"],
		["another colour's reply", "10;rgb:ffff/ffff/ffff"],
	])("reads nothing from %s", (_name, body) => {
		expect(parseBackground(body)).toBeUndefined();
	});

	it("gives the band its colour from a sample reply", () => {
		const background = parseBackground("11;rgb:1e1e/1e1e/1e1e");
		expect(bandPainter(3, background)?.("x")).toBe(
			"\x1b[48;2;60;54;78mx\x1b[49m",
		);
	});
});

describe("queryBackground", () => {
	/** A filter that counts who's listening for its sequences. */
	class CountingFilter extends InputFilter {
		listening = 0;

		override onSequence(listener: (body: string) => void): () => void {
			const stop = super.onSequence(listener);
			this.listening += 1;
			return () => {
				this.listening -= 1;
				stop();
			};
		}
	}

	let stdin: FakeStdin;
	let filter: CountingFilter;
	let output: CaptureStdout;
	let keys: string;

	beforeEach(() => {
		stdin = new FakeStdin();
		filter = new CountingFilter(stdin);
		stdin.pipe(filter);
		output = new CaptureStdout();
		keys = "";
		filter.on("data", (chunk: Buffer) => {
			keys += chunk.toString("latin1");
		});
		// Released, so whatever wasn't taken out comes through to be seen.
		filter.release();
	});

	afterEach(() => {
		vi.useRealTimers();
		filter.destroy();
	});

	it("asks the terminal for its background", () => {
		void queryBackground(filter, output);
		expect(output.text).toBe("\x1b]11;?\x07");
		expect(BACKGROUND_QUERY).toBe("\x1b]11;?\x07");
	});

	it.each([
		["BEL", "\x07"],
		["ST", "\x1b\\"],
	])("resolves with the colour of a reply ending in %s", async (_name, end) => {
		const answer = queryBackground(filter, output);
		stdin.write(`\x1b]11;rgb:ffff/ffff/ffff${end}`);
		expect(await answer).toEqual([255, 255, 255]);
		expect(keys).toBe("");
	});

	it("resolves with the colour of a reply split across reads", async () => {
		const answer = queryBackground(filter, output);
		stdin.write("\x1b]11;rgb:1e1e/1e");
		await tick();
		stdin.write("1e/1e1e\x07");
		expect(await answer).toEqual([30, 30, 30]);
	});

	it("resolves with the colour of a reply split after its ESC, no key read", async () => {
		const answer = queryBackground(filter, output);
		stdin.write("\x1b");
		await tick();
		stdin.write("]11;rgb:aaa/bbb/ccc\x07");
		expect(await answer).toEqual([170, 187, 204]);
		expect(keys).toBe("");
	});

	it("stops listening for sequences once answered", async () => {
		const answer = queryBackground(filter, output);
		expect(filter.listening).toBe(1);
		stdin.write("\x1b]11;rgb:ff/ff/ff\x07");
		await answer;
		expect(filter.listening).toBe(0);
	});

	it("stops listening for sequences once it gives up", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const answer = queryBackground(filter, output);
		vi.advanceTimersByTime(150);
		await answer;
		expect(filter.listening).toBe(0);
	});

	it("resolves with nothing at once for a reply that isn't a colour", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const answer = queryBackground(filter, output);
		stdin.write("\x1b]11;rgb:zz/zz/zz\x07");
		await tick();
		expect(vi.getTimerCount()).toBe(0);
		expect(await answer).toBeUndefined();
	});

	it("waits past other sequences for the background's", async () => {
		const answer = queryBackground(filter, output);
		stdin.write("\x1b]10;rgb:0000/0000/0000\x07\x1b]11;rgb:ff/ff/ff\x07");
		expect(await answer).toEqual([255, 255, 255]);
	});

	it("gives up after 150 ms", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let settled = false;
		const answer = queryBackground(filter, output).then((colour) => {
			settled = true;
			return colour;
		});
		vi.advanceTimersByTime(149);
		await tick();
		expect(settled).toBe(false);
		vi.advanceTimersByTime(1);
		expect(await answer).toBeUndefined();
	});

	it("swallows a reply that comes after it gave up, never as keys", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const answer = queryBackground(filter, output);
		vi.advanceTimersByTime(150);
		expect(await answer).toBeUndefined();
		stdin.write("j\x1b]11;rgb:ffff/ffff/ffff\x07k");
		await tick();
		expect(keys).toBe("jk");
	});
});

describe("terminalBackground", () => {
	const streams = (isTTY: boolean) => {
		const stdin = new FakeStdin();
		stdin.isTTY = isTTY;
		const output = new CaptureStdout((text) => {
			if (text === BACKGROUND_QUERY) {
				stdin.write("\x1b]11;rgb:1e1e/1e1e/1e1e\x07");
			}
		});
		output.isTTY = true;
		const filter = new InputFilter(stdin);
		stdin.pipe(filter);
		return { input: stdin, output, filter };
	};

	const fresh = async () => {
		vi.resetModules();
		return import("../../../src/terminal/prompts/background.js");
	};

	it("asks once per process and shares the answer", async () => {
		const { terminalBackground } = await fresh();
		const first = streams(true);
		expect(await terminalBackground(first.filter, first, 3)).toEqual([
			30, 30, 30,
		]);
		const second = streams(true);
		expect(await terminalBackground(second.filter, second, 2)).toEqual([
			30, 30, 30,
		]);
		expect(first.output.text).toBe(BACKGROUND_QUERY);
		expect(second.output.text).toBe("");
	});

	it("doesn't ask when stdin isn't a terminal", async () => {
		const { terminalBackground } = await fresh();
		const { filter, ...rest } = streams(false);
		expect(await terminalBackground(filter, rest, 3)).toBeUndefined();
		expect(rest.output.text).toBe("");
	});

	it("doesn't ask when stdout isn't a terminal", async () => {
		const { terminalBackground } = await fresh();
		const { filter, ...rest } = streams(true);
		rest.output.isTTY = false;
		expect(await terminalBackground(filter, rest, 3)).toBeUndefined();
		expect(rest.output.text).toBe("");
	});

	it("doesn't ask below 256 colours", async () => {
		const { terminalBackground } = await fresh();
		const { filter, ...rest } = streams(true);
		expect(await terminalBackground(filter, rest, 1)).toBeUndefined();
		expect(rest.output.text).toBe("");
	});
});
