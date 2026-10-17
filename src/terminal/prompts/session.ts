import type { Writable } from "node:stream";
import {
	ERASE_DOWN,
	ERASE_LINE,
	HIDE_CURSOR,
	SHOW_CURSOR,
} from "../control.js";
import { bandPainter, type Painter, type Rgb, type Style } from "../style.js";
import { terminalBackground } from "./background.js";
import type { Engine } from "./engine.js";
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
	owner: PromptOwner;
}

/** The run a prompt is asked in, which owns the process's signals. */
export interface PromptOwner {
	/** Takes the prompt while it's open, for a signal to put the terminal back for the shell; the return gives it up. */
	hold(prompt: OpenPrompt): () => void;
	/** Ctrl-z read as a key: the run suspends as on a SIGTSTP. */
	suspend(): void;
}

/** An open prompt, as the run holding it sees it. */
export interface OpenPrompt {
	/** Erases the frame, leaving the cursor where its first line began. */
	erase(): void;
	/** Ends raw mode and shows the cursor. */
	cook(): void;
	/** After a suspend: raw mode again, and the frame, once drawn, back with the cursor hidden. */
	resume(): void;
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
 * Runs `open`'s engine on the terminal. Stdin flows through the filter in raw
 * mode from before the background is asked to the answer, and the engine
 * opens only once the background is known: no prompt runs while the
 * terminal's reply may still come. The first frame is drawn, then the filter
 * lets through the keys typed in the meantime, and each key redraws the frame
 * in place. The answer erases it whole, leaving the cursor where its first
 * line began. Resolves with the engine once it's submitted or cancelled; a
 * throw on the way closes the engine and restores the terminal.
 */
export async function runPrompt<E extends Engine>(
	context: PromptContext,
	open: (streams: PromptStreams) => E,
	frame: (engine: E, band: Painter | undefined) => string[],
): Promise<E> {
	const session = new Session(context);
	let opened: Engine | undefined;
	try {
		const level = context.style.level;
		const background =
			context.background ??
			(await terminalBackground(session.filter, context, level));
		const band = bandPainter(level, background);
		const engine = open(session.streams);
		opened = engine;
		const answered = engine.prompt();
		session.show(engine, () => frame(engine, band));
		session.filter.release();
		await answered;
		session.answered();
		return engine;
	} catch (error) {
		// Closed as a cancel, the engine leaves nothing behind but its closing newline.
		opened?.abandon();
		session.restore(opened === undefined ? 0 : 1);
		throw error;
	} finally {
		session.end();
	}
}

/**
 * A prompt's hold on the terminal: stdin piped through the filter in raw
 * mode and the frame on screen, the run that owns the signals holding it
 * meanwhile. Each listener it adds goes when it ends.
 */
class Session implements OpenPrompt {
	readonly filter: InputFilter;
	private readonly screen: Screen;
	private readonly stops: (() => void)[] = [];
	/** Draws the frame, once there is one. */
	private paint?: () => void;

	constructor(private readonly context: PromptContext) {
		this.filter = new InputFilter(context.input);
		this.screen = new Screen(context.output);
		this.filter.setRawMode(true);
		context.input.pipe(this.filter);
		this.stops.push(context.owner.hold(this));
	}

	get streams(): PromptStreams {
		return { input: this.filter, output: this.context.output };
	}

	/** Draws the first frame, then again after each key while `engine` is open, and tells the run of its ctrl-z. */
	show(engine: Engine, frame: () => string[]): void {
		const paint = () => this.screen.draw(frame());
		this.paint = paint;
		this.context.output.write(HIDE_CURSOR);
		paint();
		const redraw = () => {
			if (engine.asking) {
				paint();
			}
		};
		// After the engine's own listener, so each frame shows the key's effect.
		this.filter.on("keypress", redraw);
		this.stops.push(() => this.filter.off("keypress", redraw));
		this.followSuspend(engine);
	}

	erase(): void {
		this.screen.erase();
	}

	cook(): void {
		this.context.output.write(SHOW_CURSOR);
		this.filter.setRawMode(false);
	}

	resume(): void {
		this.filter.setRawMode(true);
		if (this.paint !== undefined) {
			this.context.output.write(HIDE_CURSOR);
			this.paint();
		}
	}

	/** The engine closes with a newline, shows the cursor and ends raw mode: the frame goes, and the newline with it. */
	answered(): void {
		this.screen.erase(1);
	}

	/** Erases the frame, and `below` lines written under it, shows the cursor and ends raw mode. */
	restore(below = 0): void {
		this.screen.erase(below);
		this.cook();
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
	 * Readline on its own suspends on ctrl-z by stopping node alone, so a
	 * parent such as npx runs on and the shell sees nothing stop. With a
	 * listener for its SIGTSTP it only tells, in its handling of the key, ahead
	 * of every key after it, and the run suspends as it does on a SIGTSTP.
	 */
	private followSuspend(engine: Engine): void {
		const readline = engine.readline;
		const suspend = () => this.context.owner.suspend();
		readline?.on("SIGTSTP", suspend);
		this.stops.push(() => readline?.off("SIGTSTP", suspend));
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
