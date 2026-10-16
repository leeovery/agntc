import type { Key } from "node:readline";
import type { Writable } from "node:stream";
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
 * Runs `open`'s engine on the terminal. Stdin flows through the filter in raw
 * mode from before the background is asked to the answer, and the engine
 * opens only once the background is known: no prompt runs while the
 * terminal's reply may still come. The first frame is drawn, then the filter
 * lets through the keys typed in the meantime, and each key redraws the frame
 * in place. The answer erases it whole, leaving the cursor where its first
 * line began. Resolves with the engine once it's submitted or cancelled; a
 * throw on the way closes the engine and restores the terminal as an exit does.
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

function isOpen(engine: Engine): boolean {
	return engine.state !== "submit" && engine.state !== "cancel";
}

/**
 * A prompt's hold on the terminal: stdin piped through the filter in raw
 * mode, the frame on screen, and the process watched for its exit and, once
 * the engine runs, for a suspend. Each listener it adds goes when it ends.
 */
class Session {
	readonly filter: InputFilter;
	private readonly screen: Screen;
	private readonly stops: (() => void)[] = [];
	/** From ctrl-z to the stop it leads to: the frame stays erased. */
	private suspended = false;

	constructor(private readonly context: PromptContext) {
		this.filter = new InputFilter(context.input);
		this.screen = new Screen(context.output);
		this.filter.setRawMode(true);
		context.input.pipe(this.filter);
		this.stops.push(
			restoreOnExit(context.host ?? process, () => this.restore()),
		);
	}

	get streams(): PromptStreams {
		return { input: this.filter, output: this.context.output };
	}

	/** Draws the first frame, then again after each key while `engine` is open, and follows it through a suspend. */
	show(engine: Engine, frame: () => string[]): void {
		const paint = () => this.screen.draw(frame());
		this.context.output.write(HIDE_CURSOR);
		paint();
		const redraw = () => {
			if (isOpen(engine) && !this.suspended) {
				paint();
			}
		};
		// After the engine's own listener, so each frame shows the key's effect.
		this.filter.on("keypress", redraw);
		this.stops.push(() => this.filter.off("keypress", redraw));
		this.followSuspend(engine, paint);
	}

	/** The engine closes with a newline, shows the cursor and ends raw mode: the frame goes, and the newline with it. */
	answered(): void {
		this.screen.erase(1);
	}

	/** Erases the frame, and `below` lines written under it, shows the cursor and ends raw mode. */
	restore(below = 0): void {
		this.screen.erase(below);
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
	 * Readline suspends on ctrl-z by turning raw mode off and sending SIGTSTP
	 * to node alone, and on SIGCONT pauses the filter, which nothing then
	 * resumes. Ahead of it the frame is erased and the cursor shown, for the
	 * shell, and kept so until the stop. Its SIGTSTP is caught and sent on to
	 * the whole process group, as a terminal's ^Z is, so a parent such as npx
	 * stops too and the shell sees its job stop. Once continued, and again
	 * after readline's own SIGCONT listener, which may come after this one, the
	 * filter reads in raw mode and the frame is drawn afresh. All of it is on
	 * the process itself, where readline suspends and listens.
	 */
	private followSuspend(engine: Engine, paint: () => void): void {
		const resume = () => {
			if (!isOpen(engine)) {
				return;
			}
			this.suspended = false;
			this.filter.setRawMode(true);
			this.filter.resume();
			this.context.output.write(HIDE_CURSOR);
			paint();
		};
		const stop = () => {
			this.suspend();
			this.filter.setRawMode(false);
			// With no listener, SIGTSTP stops the process as it does by default.
			process.off("SIGTSTP", stop);
			process.kill(0, "SIGTSTP");
			process.on("SIGTSTP", stop);
			resume();
		};
		const beforeSuspend = (_char: unknown, key: Key | undefined) => {
			if (suspends(key)) {
				this.suspend();
			}
		};
		const continued = () => process.nextTick(resume);
		this.filter.prependListener("keypress", beforeSuspend);
		process.on("SIGTSTP", stop);
		process.on("SIGCONT", continued);
		this.stops.push(() => {
			this.filter.off("keypress", beforeSuspend);
			process.off("SIGTSTP", stop);
			process.off("SIGCONT", continued);
		});
	}

	private suspend(): void {
		if (this.suspended) {
			return;
		}
		this.suspended = true;
		this.screen.erase();
		this.context.output.write(SHOW_CURSOR);
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
