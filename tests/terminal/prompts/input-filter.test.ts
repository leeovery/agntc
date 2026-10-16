import { afterEach, describe, expect, it, vi } from "vitest";
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

	it("passes a lone ESC at once", async () => {
		const { filter, read } = filtering();
		await send(filter, "\x1b");
		expect(read()).toBe("\x1b");
		await send(filter, "j\x1b");
		expect(read()).toBe("\x1bj\x1b");
	});

	it("lets a partial sequence through as it stands after 100 ms", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { filter, read } = filtering();
		await send(filter, "\x1b]11;rgb:1e");
		vi.advanceTimersByTime(99);
		await tick();
		expect(read()).toBe("");
		await send(filter, "1e");
		vi.advanceTimersByTime(1);
		await tick();
		expect(read()).toBe("\x1b]11;rgb:1e1e");
	});

	it("lets a partial sequence through at once at 64 bytes", async () => {
		const { filter, read } = filtering();
		const partial = `\x1b]${"x".repeat(61)}`;
		await send(filter, partial);
		expect(read()).toBe("");
		await send(filter, "y");
		expect(read()).toBe(`${partial}y`);
	});

	it("lets nothing through once destroyed, the held part with it", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { filter, read } = filtering();
		await send(filter, "\x1b]11;");
		filter.destroy();
		vi.advanceTimersByTime(200);
		await tick();
		expect(read()).toBe("");
		expect(vi.getTimerCount()).toBe(0);
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
