import type { Key } from "node:readline";
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
 * while it runs, read by the engine from the start, so keys typed while the
 * background is asked are read as they come. The first frame is drawn once
 * the background is known, then again after each key, in place, and the
 * answer erases it whole, leaving the cursor where its first line began.
 * Resolves with the engine once it's submitted or cancelled; a throw on the
 * way restores the terminal as an exit does.
 */
export async function runPrompt<E extends Prompt>(
	context: PromptContext,
	open: (streams: PromptStreams) => E,
	frame: (engine: E, band: Painter | undefined) => string[],
): Promise<E> {
	const session = new Session(context);
	try {
		const engine = open(session.streams);
		const answered = engine.prompt();
		const level = context.style.level;
		const background =
			context.background ??
			(await terminalBackground(session.filter, context, level));
		const band = bandPainter(level, background);
		if (isOpen(engine)) {
			session.show(
				() => frame(engine, band),
				() => isOpen(engine),
			);
		}
		await answered;
		session.answered();
		return engine;
	} catch (error) {
		session.restore();
		throw error;
	} finally {
		session.end();
	}
}

function isOpen(engine: Prompt): boolean {
	return engine.state !== "submit" && engine.state !== "cancel";
}

/**
 * A prompt's hold on the terminal: stdin piped through the filter in raw
 * mode, the frame on screen, and the process watched for its exit and for a
 * suspend. Each listener it adds goes when it ends.
 */
class Session {
	readonly filter: InputFilter;
	private readonly screen: Screen;
	/** Draws the frame as it stands, once the first is drawn. */
	private paint: (() => void) | undefined;
	private readonly stops: (() => void)[] = [];

	constructor(private readonly context: PromptContext) {
		this.filter = new InputFilter(context.input);
		this.screen = new Screen(context.output);
		context.input.pipe(this.filter);
		this.filter.setRawMode(true);
		this.stops.push(
			restoreOnExit(context.host ?? process, () => this.restore()),
		);
		this.followSuspend();
	}

	get streams(): PromptStreams {
		return { input: this.filter, output: this.context.output };
	}

	/** Draws the first frame, and again after each key while `open`. */
	show(frame: () => string[], open: () => boolean): void {
		const paint = () => this.screen.draw(frame());
		this.paint = paint;
		this.context.output.write(HIDE_CURSOR);
		paint();
		const redraw = () => {
			if (open()) {
				paint();
			}
		};
		// After the engine's own listener, so each frame shows the key's effect.
		this.filter.on("keypress", redraw);
		this.stops.push(() => this.filter.off("keypress", redraw));
	}

	/** The engine closes with a newline, shows the cursor and ends raw mode: the frame goes, and the newline with it. */
	answered(): void {
		this.screen.erase(1);
	}

	restore(): void {
		this.screen.erase();
		this.context.output.write(SHOW_CURSOR);
		this.filter.setRawMode(false);
	}

	end(): void {
		for (const stop of this.stops) {
			stop();
		}
		this.context.input.unpipe(this.filter);
		this.context.input.pause();
		this.filter.destroy();
	}

	/**
	 * Readline suspends the process on ctrl-z, raw mode off, and on SIGCONT
	 * pauses the filter, which nothing then resumes. So ahead of its suspend
	 * the frame is erased and the cursor shown, for the shell; after its
	 * SIGCONT listener, which may come after this one, the filter reads again
	 * in raw mode and the frame is drawn afresh. Both follow readline onto the
	 * process itself, as that's where it suspends and listens.
	 */
	private followSuspend(): void {
		const beforeSuspend = (_char: unknown, key: Key | undefined) => {
			if (suspends(key)) {
				this.screen.erase();
				this.context.output.write(SHOW_CURSOR);
			}
		};
		const continued = () => process.nextTick(() => this.resume());
		this.filter.prependListener("keypress", beforeSuspend);
		process.on("SIGCONT", continued);
		this.stops.push(() => {
			this.filter.off("keypress", beforeSuspend);
			process.off("SIGCONT", continued);
		});
	}

	private resume(): void {
		this.filter.setRawMode(true);
		this.filter.resume();
		if (this.paint !== undefined) {
			this.context.output.write(HIDE_CURSOR);
			this.paint();
		}
	}
}

/** Whether readline suspends the process on `key`: ctrl-z, but not with shift, nor on Windows. */
function suspends(key: Key | undefined): boolean {
	return (
		key?.ctrl === true &&
		key.shift !== true &&
		key.name === "z" &&
		process.platform !== "win32"
	);
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

	/** Erases the frame, the cursor `below` lines under its last, or under where it would begin with none drawn. */
	erase(below = 0): void {
		if (this.height + below === 0) {
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
