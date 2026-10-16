import { emitKeypressEvents, type Interface } from "node:readline";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputFilter } from "../../../src/terminal/prompts/input-filter.js";
import { FakeStdin, tick } from "./terminal.js";

const REPLY = "\x1b]11;rgb:1e1e/1e1e/1e1e";
const REPLY_END = `${REPLY}\x07`;
const BODY = "11;rgb:1e1e/1e1e/1e1e";

/** What readline makes of an ESC nothing follows in time. */
const ESCAPE_KEY = {
	sequence: "\x1b",
	name: "escape",
	ctrl: false,
	meta: true,
	shift: false,
};

/** A released filter read as readline reads one: each chunk as it comes, keys heard. */
function filtering() {
	const source = new FakeStdin();
	const filter = new InputFilter(source);
	const chunks: Buffer[] = [];
	const bodies: string[] = [];
	const keys: unknown[] = [];
	filter.on("data", (chunk: Buffer) => chunks.push(chunk));
	filter.on("keypress", (...key: unknown[]) => keys.push(key));
	filter.onSequence((body) => bodies.push(body));
	filter.release();
	const read = () => Buffer.concat(chunks).toString("latin1");
	return { source, filter, read, bodies, keys };
}

/** Readline reading `filter` as core's prompt does: the keys it makes of what comes, by name. */
function decoding(filter: InputFilter): string[] {
	const names: string[] = [];
	emitKeypressEvents(filter, { escapeCodeTimeout: 50 } as unknown as Interface);
	filter.on("keypress", (_char: unknown, key: { name?: string }) => {
		names.push(key.name ?? "?");
	});
	return names;
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

	it("hands over the escape key readline itself makes of an ESC nothing follows", async () => {
		const stdin = new PassThrough();
		const core = { escapeCodeTimeout: 50 } as unknown as Interface;
		emitKeypressEvents(stdin, core);
		const fromReadline: unknown[] = [];
		stdin.on("keypress", (...key: unknown[]) => fromReadline.push(key));
		const { filter, keys } = filtering();
		stdin.write("\x1b");
		filter.write("\x1b");
		await sleep(80);
		expect(fromReadline).toEqual([[undefined, ESCAPE_KEY]]);
		expect(keys).toEqual(fromReadline);
	});

	describe("holding", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		});

		const waited = async (ms: number) => {
			vi.advanceTimersByTime(ms);
			await tick();
		};

		it("hands a lone ESC over as the escape key once readline's 50 ms go by, pushing nothing", async () => {
			const { filter, read, keys } = filtering();
			await send(filter, "\x1b");
			await waited(49);
			expect(keys).toEqual([]);
			await waited(1);
			expect(keys).toEqual([[undefined, ESCAPE_KEY]]);
			expect(read()).toBe("");
			expect(vi.getTimerCount()).toBe(0);
		});

		it("passes a held ESC with the byte that follows it inside 50 ms, as readline would join them", async () => {
			const { filter, read, keys } = filtering();
			await send(filter, "\x1b");
			await waited(49);
			await send(filter, "j");
			expect(read()).toBe("\x1bj");
			await waited(100);
			expect(keys).toEqual([]);
		});

		it("delivers nothing until released, then all of it in order, each escape key between the text either side", async () => {
			const filter = new InputFilter(new FakeStdin());
			const names = decoding(filter);
			await send(filter, "\x1b");
			await waited(50);
			await send(filter, "a", "\x1b");
			await waited(50);
			await send(filter, "b\x1b]11;rgb:1e/1e/1e\x07c");
			expect(names).toEqual([]);
			filter.release();
			await send(filter, "d");
			expect(names).toEqual(["escape", "a", "escape", "b", "c", "d"]);
		});

		it("joins a held ESC with the key after it, and reads a lone one as escape, as it holds them back", async () => {
			const filter = new InputFilter(new FakeStdin());
			const names = decoding(filter);
			await send(filter, "\x1b");
			await waited(40);
			await send(filter, "j", "\x1b");
			await waited(50);
			await send(filter, "j");
			filter.release();
			await tick();
			expect(names).toEqual(["j", "escape", "j"]);
		});

		it("keeps an escape key behind the text ahead of it when readline starts reading at the release", async () => {
			const filter = new InputFilter(new FakeStdin());
			await send(filter, "a", "\x1b");
			await waited(50);
			await send(filter, "b");
			const names = decoding(filter);
			filter.release();
			await tick();
			expect(names).toEqual(["a", "escape", "b"]);
		});

		it.each([
			["a read after it", ["\x1b", REPLY_END]],
			["the read it ends", [`\x1b${REPLY_END}`]],
		])("keeps an ESC's 50 ms through a reply taken out in %s", async (_where, reads) => {
			const { filter, read, keys } = filtering();
			const [first, ...rest] = reads;
			await send(filter, first ?? "");
			await waited(20);
			await send(filter, ...rest);
			await waited(29);
			expect(keys).toEqual([]);
			await waited(1);
			expect(keys).toEqual([[undefined, ESCAPE_KEY]]);
			expect(read()).toBe("");
		});

		it("passes an ESC with the key after a reply taken out after it, inside its 50 ms", async () => {
			const { filter, read, keys } = filtering();
			await send(filter, "\x1b");
			await waited(20);
			await send(filter, REPLY_END);
			await waited(20);
			await send(filter, "j");
			expect(read()).toBe("\x1bj");
			await waited(100);
			expect(keys).toEqual([]);
		});

		it("makes the escape key of an ESC held back with a reply after it, at its own time and not the release's", async () => {
			const filter = new InputFilter(new FakeStdin());
			const names = decoding(filter);
			await send(filter, "\x1b");
			await waited(20);
			await send(filter, REPLY_END);
			filter.release();
			await waited(50);
			await send(filter, "j");
			expect(names).toEqual(["escape", "j"]);
		});

		it("starts a sequence only with a ] straight after the ESC, not one after a reply taken out", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b");
			await waited(20);
			await send(filter, REPLY_END, "]");
			expect(read()).toBe("\x1b]");
			expect(bodies).toEqual([BODY]);
		});

		it("waits afresh when a held ESC turns into a sequence, and takes out a reply ending inside that wait", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b");
			await waited(40);
			await send(filter, "]11;rgb:1e");
			await waited(99);
			await send(filter, "1e/1e1e/1e1e\x07j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([BODY]);
			expect(vi.getTimerCount()).toBe(0);
		});

		it("waits afresh for a sequence that starts in a read the one before it ends in", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b]11;rgb:1e");
			await waited(60);
			await send(filter, "1e/1e1e/1e1e\x07\x1b]11;rgb:2e");
			await waited(99);
			await send(filter, "2e/2e2e/2e2e\x07j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([BODY, "11;rgb:2e2e/2e2e/2e2e"]);
		});

		it("keeps a sequence's wait as it carries on across reads, dropping its start 100 ms after it began", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b]11;rgb:1e");
			await waited(60);
			await send(filter, "1e/");
			await waited(40);
			await send(filter, "1e1e/1e1e\x07j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([]);
		});

		it.each([
			["BEL", "\x07"],
			["ST", "\x1b\\"],
		])("takes out the rest of a dropped reply, up to its %s", async (_end, end) => {
			const { filter, read, bodies } = filtering();
			await send(filter, "\x1b]11;rgb:aaaa");
			await waited(150);
			await send(filter, `/aaa/aaaa${end}`, "j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([]);
			expect(vi.getTimerCount()).toBe(0);
		});

		it("stops taking out a dropped reply's rest at a byte no reply holds", async () => {
			const { filter, read } = filtering();
			await send(filter, "\x1b]11;rgb:aaaa");
			await waited(100);
			await send(filter, "/aa", "a\rj");
			expect(read()).toBe("\rj");
			expect(vi.getTimerCount()).toBe(0);
		});

		it("stops taking out a dropped reply's rest 100 ms after the drop", async () => {
			const { filter, read } = filtering();
			await send(filter, "\x1b]11;rgb:aaaa");
			await waited(100);
			await send(filter, "/aaa");
			await waited(99);
			await send(filter, "/a");
			expect(read()).toBe("");
			await waited(1);
			await send(filter, "a");
			expect(read()).toBe("a");
		});

		it("lets every key through once a dropped reply's rest has ended, its old deadline gone by", async () => {
			const { filter, read } = filtering();
			await send(filter, "\x1b]11;rgb:aaaa");
			await waited(100);
			await send(filter, "/aaa\x07");
			await waited(150);
			await send(filter, "a1;");
			expect(read()).toBe("a1;");
			expect(vi.getTimerCount()).toBe(0);
		});

		it("drops a sequence's start as soon as it grows past 64 bytes, a key no reply holds passing straight after", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, `\x1b]${"x".repeat(62)}`, "y", "k", "\x07");
			expect(read()).toBe("k\x07");
			expect(bodies).toEqual([]);
			expect(vi.getTimerCount()).toBe(0);
		});

		it("takes out the rest of a reply whose start grew past 64 bytes", async () => {
			const { filter, read, bodies } = filtering();
			await send(filter, `\x1b]${"x".repeat(62)}`, "y", "1e1e\x07j");
			expect(read()).toBe("j");
			expect(bodies).toEqual([]);
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
