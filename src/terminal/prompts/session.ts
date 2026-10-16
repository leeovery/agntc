import type { Writable } from "node:stream";
import type { Prompt } from "@clack/core";
import {
	ERASE_DOWN,
	ERASE_LINE,
	type ExitHost,
	HIDE_CURSOR,
	restoreOnExit,
	SHOW_CURSOR,
} from "../control.js";
import { bandPainter, type Painter, type Rgb, type Style } from "../style.js";
import { terminalBackground } from "./background.js";
import { InputFilter, type PromptInput } from "./input-filter.js";

/** The stdout a prompt draws on. */
export interface PromptOutput extends Writable {
	isTTY?: boolean;
	rows?: number;
}

export interface PromptContext {
	input: PromptInput;
	output: PromptOutput;
	width: number;
	style: Style;
	/** The terminal's background when it's known; otherwise asked once per process. */
	background?: Rgb;
	/** The process the terminal is restored on the exit of; tests pass their own. */
	host?: ExitHost;
}

/** What a prompt engine reads and writes: stdin through the filter. */
export interface PromptStreams {
	input: InputFilter;
	output: PromptOutput;
}

/**
 * Core's own renderer trims every line's leading and trailing spaces (the
 * margin, the band's fill), so an engine draws nothing and the session
 * draws each frame.
 */
export const noFrame = (): undefined => undefined;

/**
 * Runs `open`'s engine on the terminal: stdin flows through the filter only
 * while it runs, raw mode on from the background query to the answer. Each
 * keypress redraws `frame` in place, and the answer erases it whole,
 * leaving the cursor where its first line began. Resolves with the engine
 * once it's submitted or cancelled.
 */
export async function runPrompt<E extends Prompt>(
	context: PromptContext,
	open: (streams: PromptStreams) => E,
	frame: (engine: E, band: Painter | undefined) => string[],
): Promise<E> {
	const { input, output, style } = context;
	const filter = new InputFilter(input);
	const screen = new Screen(output);
	input.pipe(filter);
	filter.setRawMode(true);
	const stopWatching = restoreOnExit(context.host ?? process, () => {
		screen.erase();
		output.write(SHOW_CURSOR);
		filter.setRawMode(false);
	});
	try {
		const background =
			context.background ??
			(await terminalBackground(filter, context, style.level));
		const band = bandPainter(style.level, background);
		const engine = open({ input: filter, output });
		const draw = () => screen.draw(frame(engine, band));
		output.write(HIDE_CURSOR);
		draw();
		const answered = engine.prompt();
		// After the engine's own listener, so each frame shows the key's effect.
		filter.on("keypress", () => {
			if (engine.state !== "submit" && engine.state !== "cancel") {
				draw();
			}
		});
		await answered;
		// The engine closes with a newline and shows the cursor.
		screen.erase(1);
		return engine;
	} finally {
		stopWatching();
		filter.setRawMode(false);
		input.unpipe(filter);
		input.pause();
		filter.destroy();
	}
}

/** The lines a prompt has on screen, redrawn in place and erased whole. */
class Screen {
	private height = 0;
	private shown = "";

	constructor(private readonly output: PromptOutput) {}

	draw(lines: readonly string[]): void {
		const text = lines.map((line) => ERASE_LINE + line).join("\n");
		if (text === this.shown) {
			return;
		}
		this.output.write(`${this.toTop(0)}${text}${ERASE_DOWN}`);
		this.shown = text;
		this.height = lines.length;
	}

	/** Erases the frame, the cursor `below` lines under its last. */
	erase(below = 0): void {
		if (this.height === 0) {
			return;
		}
		this.output.write(`${this.toTop(below)}${ERASE_DOWN}`);
		this.shown = "";
		this.height = 0;
	}

	private toTop(below: number): string {
		const up = Math.max(0, this.height - 1) + below;
		return up > 0 ? `\r\x1b[${up}A` : "\r";
	}
}
