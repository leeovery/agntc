import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputFilter } from "../../../src/terminal/prompts/input-filter.js";
import { FakeStdin, tick } from "./terminal.js";

const REPLY = "\x1b]11;rgb:1e1e/1e1e/1e1e";
const BODY = "11;rgb:1e1e/1e1e/1e1e";

function filtering() {
	const source = new FakeStdin();
	const filter = new InputFilter(source);
	const chunks: Buffer[] = [];
	const bodies: string[] = [];
	filter.on("data", (chunk: Buffer) => chunks.push(chunk));
	filter.onSequence((body) => bodies.push(body));
	const read = () => Buffer.concat(chunks).toString("latin1");
	return { source, filter, read, bodies };
}

async function send(filter: InputFilter, ...writes: (string | Buffer)[]) {
	for (const data of writes) {
		filter.write(data);
		await tick();
	}
}

describe("InputFilter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("passes keys through as they come", async () => {
		const { filter, read } = filtering();
		await send(filter, "j", "\x1b[B", " a\r");
		expect(read()).toBe("j\x1b[B a\r");
	});

	it("passes a key's UTF-8 through whole when its bytes come apart", async () => {
		const { filter, read } = filtering();
		const bytes = Buffer.from("é");
		await send(filter, bytes.subarray(0, 1), bytes.subarray(1));
		expect(Buffer.from(read(), "latin1").toString("utf8")).toBe("é");
	});

	it("takes out a reply in one chunk, ending in BEL, and reports it", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, `j${REPLY}\x07k`);
		expect(read()).toBe("jk");
		expect(bodies).toEqual([BODY]);
	});

	it("takes out a reply ending in ST", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, `${REPLY}\x1b\\k`);
		expect(read()).toBe("k");
		expect(bodies).toEqual([BODY]);
	});

	it("holds a reply split across chunks until its end comes", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, "j\x1b]11;rgb:1e1e/");
		expect(read()).toBe("j");
		await send(filter, "1e1e/1e", "1e\x1b", "\\k");
		expect(read()).toBe("jk");
		expect(bodies).toEqual([BODY]);
	});

	it("takes out every OSC sequence, not only the background's", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, "\x1b]10;rgb:ffff/ffff/ffff\x07j\x1b]52;c;eA==\x07");
		expect(read()).toBe("j");
		expect(bodies).toEqual(["10;rgb:ffff/ffff/ffff", "52;c;eA=="]);
	});

	it("drops a sequence an ESC cuts short and passes what the ESC starts", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, "\x1b]11;rgb:1e\x1b[A");
		expect(read()).toBe("\x1b[A");
		expect(bodies).toEqual([]);
	});

	it("passes an ESC with bytes after it in the same read at once", async () => {
		const { filter, read } = filtering();
		await send(filter, "\x1b[A", "\x1bj", "\x1b\x1b[B");
		expect(read()).toBe("\x1b[A\x1bj\x1b\x1b[B");
	});

	it("takes out a reply split after its ESC", async () => {
		const { filter, read, bodies } = filtering();
		await send(filter, "j\x1b");
		expect(read()).toBe("j");
		await send(filter, "]11;rgb:aaa/bbb/ccc\x07k");
		expect(read()).toBe("jk");
		expect(bodies).toEqual(["11;rgb:aaa/bbb/ccc"]);
	});

	it("passes a read's last ESC as soon as the byte after it isn't ]", async () => {
		const { filter, read } = filtering();
		await send(filter, "\x1b");
		expect(read()).toBe("");
		await send(filter, "[A");
		expect(read()).toBe("\x1b[A");
		await send(filter, "\x1b", "j");
		expect(read()).toBe("\x1b[A\x1bj");
	});

	describe("holding", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		});

		const waited = async (ms: number) => {
			vi.advanceTimersByTime(ms);
			await tick();
		};

		it("passes a lone ESC, the escape key, once 100 ms go by", async () => {
			const { filter, read } = filtering();
			await send(filter, "\x1b");
			await waited(99);
			expect(read()).toBe("");
			await waited(1);
			expect(read()).toBe("\x1b");
		});

		it("drops a sequence's start 100 ms after the hold began, and passes what comes after", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b");
			await waited(40);
			await send(filter, "]11;rgb:1e");
			await waited(59);
			expect(read()).toBe("");
			await send(filter, "1e");
			await waited(1);
			expect(read()).toBe("");
			await send(filter, "j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([]);
			expect(vi.getTimerCount()).toBe(0);
		});

		it("drops a sequence's start as soon as it grows past 64 bytes", async () => {
			const { filter, read } = filtering();
			const start = `\x1b]${"x".repeat(62)}`;
			await send(filter, start);
			expect(vi.getTimerCount()).toBe(1);
			await send(filter, "y");
			expect(vi.getTimerCount()).toBe(0);
			await send(filter, "j");
			await waited(200);
			expect(read()).toBe("j");
		});

		it("clears its wait and lets nothing through once destroyed", async () => {
			const { filter, read } = filtering();
			await send(filter, "\x1b");
			expect(vi.getTimerCount()).toBe(1);
			filter.destroy();
			expect(vi.getTimerCount()).toBe(0);
			await waited(200);
			expect(read()).toBe("");
		});

		it("passes a held ESC when stdin ends, and drops a sequence's start", async () => {
			const lone = filtering();
			lone.filter.end("\x1b");
			await tick();
			expect(lone.read()).toBe("\x1b");
			const started = filtering();
			started.filter.end("\x1b]11;rgb:1e");
			await tick();
			expect(started.read()).toBe("");
		});
	});

	it("reads as a terminal, its raw mode the source's", () => {
		const { source, filter } = filtering();
		expect(filter.isTTY).toBe(true);
		filter.setRawMode(true);
		expect(source.rawModes).toEqual([true]);
		expect(filter.isRaw).toBe(true);
		filter.setRawMode(false);
		expect(filter.isRaw).toBe(false);
	});

	it("stops reporting to a listener that stopped", async () => {
		const { filter } = filtering();
		const heard: string[] = [];
		const stop = filter.onSequence((body) => heard.push(body));
		stop();
		await send(filter, `${REPLY}\x07`);
		expect(heard).toEqual([]);
	});
});
