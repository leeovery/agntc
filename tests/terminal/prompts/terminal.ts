import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import xterm from "@xterm/headless";
import { vi } from "vitest";
import { BACKGROUND_QUERY } from "../../../src/terminal/prompts/background.js";
import type { PromptContext } from "../../../src/terminal/prompts/session.js";
import { createStyle, type Style } from "../../../src/terminal/style.js";
import type { TaskHost } from "../../../src/terminal/task.js";

export const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	enter: "\r",
	space: " ",
	tab: "\t",
	escape: "\x1b",
	ctrlC: "\x03",
} as const;

/** A terminal's stdin: keys written to it are read, and raw mode is recorded. */
export class FakeStdin extends PassThrough {
	isTTY = true;
	isRaw = false;
	readonly rawModes: boolean[] = [];

	setRawMode(mode: boolean): this {
		this.isRaw = mode;
		this.rawModes.push(mode);
		return this;
	}
}

/** A stdout that keeps everything written to it, and hands each write on. */
export class CaptureStdout extends Writable {
	text = "";
	isTTY?: boolean;
	rows?: number;

	constructor(private readonly onWrite: (text: string) => void = () => {}) {
		super({ decodeStrings: false });
	}

	override _write(
		chunk: string | Buffer,
		_encoding: BufferEncoding,
		done: () => void,
	): void {
		const text = chunk.toString();
		this.text += text;
		this.onWrite(text);
		done();
	}
}

export class FakeHost extends EventEmitter implements TaskHost {
	exit = vi.fn();
}

/** Lets piped keys reach the prompt and its frame reach the output. */
export function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A headless xterm wired to a fake stdin and a capturing stdout, newlines
 * returning to the first column as a terminal's do. Asked its background, it
 * answers only once given a reply to answer with, its parts 3 ms apart.
 */
export class Terminal {
	readonly input = new FakeStdin();
	readonly output: CaptureStdout;
	readonly host = new FakeHost();
	backgroundReply: string | readonly string[] | undefined;
	private readonly term: xterm.Terminal;

	constructor(
		readonly columns = 80,
		readonly rows = 24,
	) {
		this.term = new xterm.Terminal({
			cols: columns,
			rows,
			allowProposedApi: true,
			convertEol: true,
		});
		this.output = new CaptureStdout((text) => {
			this.term.write(text);
			if (text === BACKGROUND_QUERY && this.backgroundReply !== undefined) {
				[this.backgroundReply].flat().forEach((part, index) => {
					setTimeout(() => this.input.write(part), 3 * index);
				});
			}
		});
		this.output.rows = rows;
	}

	context(style: Style = createStyle(0), width = this.columns): PromptContext {
		return {
			input: this.input,
			output: this.output,
			width,
			style,
			host: this.host,
		};
	}

	async press(...keys: string[]): Promise<void> {
		for (const key of keys) {
			this.input.write(key);
			await tick();
		}
	}

	/** Every line written, scrollback included, the trailing empty ones left off. */
	async lines(): Promise<string[]> {
		await this.flushed();
		const buffer = this.term.buffer.active;
		const lines = Array.from(
			{ length: buffer.length },
			(_, row) => buffer.getLine(row)?.translateToString(true) ?? "",
		);
		while (lines.at(-1) === "") {
			lines.pop();
		}
		return lines;
	}

	/** The cursor's column and its row, counted from the top of the scrollback. */
	async cursor(): Promise<[number, number]> {
		await this.flushed();
		const buffer = this.term.buffer.active;
		return [buffer.cursorX, buffer.baseY + buffer.cursorY];
	}

	private flushed(): Promise<void> {
		return new Promise((resolve) => this.term.write("", resolve));
	}
}
