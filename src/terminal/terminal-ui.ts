import { ExitSignal } from "../exit-signal.js";
import type { Message } from "../message.js";
import type {
	Block,
	ConfirmPrompt,
	FailOptions,
	Log,
	MultiselectPrompt,
	SelectPrompt,
	Spinner,
	Tally,
	Ui,
} from "../ui.js";
import { blockLayout, renderProgress, renderRow } from "./block.js";
import { renderCancel, renderClose } from "./close.js";
import type { ExitHost } from "./control.js";
import { renderHeader } from "./header.js";
import { layoutWidth } from "./layout.js";
import {
	KIND_STATUS,
	type MessageKind,
	renderMessage,
	renderWritten,
} from "./message.js";
import { renderNext } from "./next.js";
import { promptConfirm } from "./prompts/confirm.js";
import type { PromptInput } from "./prompts/input-filter.js";
import { promptMultiselect } from "./prompts/multiselect.js";
import { promptSelect } from "./prompts/select.js";
import type { PromptContext, PromptOutput } from "./prompts/session.js";
import {
	createStyle,
	detectColorLevel,
	identity,
	type Style,
} from "./style.js";
import { outcomeCount, tallyItems } from "./tally.js";
import { startTask, type Task } from "./task.js";
import type { BlockSubject, Header, NextItem, Row, Status } from "./types.js";

/** The stdout a terminal run draws on. */
export interface TerminalOutput extends PromptOutput {
	columns?: number;
}

/** What a terminal run draws on: the process's own, but for what's given. */
export interface TerminalUiOptions {
	/** What the run's header says; without one, it has none. */
	header?: Header;
	input?: PromptInput;
	output?: TerminalOutput;
	env?: Readonly<Record<string, string | undefined>>;
	/** The process whose exit, a signal's included, shows the cursor again. */
	host?: ExitHost;
	/** Milliseconds, read for the elapsed time the close shows. */
	clock?: () => number;
}

/** A spinning line, and what the run printed while it spun. */
interface Live {
	render: (frame: string) => string;
	/** Unset while it's paused. */
	task?: Task;
	held: string[];
}

interface Spinning {
	settle(lines: readonly string[]): void;
	clear(): void;
}

/**
 * A command run at a terminal, drawn by the renderer. One line spins at a
 * time, the newest task's: a task started under another pauses it until it
 * ends, and a prompt pauses it while it asks. What's printed while a task
 * spins prints under the lines it settles into, or above a prompt that opens
 * meanwhile.
 */
export class TerminalUi implements Ui {
	readonly mode = "interactive";
	readonly log: Log = {
		info: (message) => this.print(this.written("note", message)),
		warn: (message) => this.print(this.written("attention", message)),
		error: (message) => this.print(this.written("failed", message)),
		success: (message) => this.print(this.written("done", message)),
		message: (message) => this.print(this.written(undefined, message)),
	};
	private readonly options: TerminalUiOptions;
	private readonly output: TerminalOutput;
	private readonly style: Style;
	private readonly clock: () => number;
	private readonly started: number;
	private readonly queued: NextItem[] = [];
	/** The newest last, the one spinning. */
	private readonly live: Live[] = [];
	private headed = false;
	/** Whether the last line written is blank; so it is before anything is, and a first block opens no blank line. */
	private atBlank = true;

	constructor(options: TerminalUiOptions = {}) {
		this.options = options;
		this.output = options.output ?? process.stdout;
		this.style = createStyle(
			detectColorLevel(options.env ?? process.env, this.output.isTTY === true),
		);
		this.clock = options.clock ?? (() => performance.now());
		this.started = this.clock();
	}

	header(): void {
		const { header } = this.options;
		if (this.headed || header === undefined) {
			return;
		}
		this.headed = true;
		this.print([...renderHeader(header, this.width(), this.style), ""]);
	}

	/** A block after other lines opens a blank line below them, as it first draws. */
	block(subjects: readonly BlockSubject[]): Block {
		const width = this.width();
		const layout = blockLayout(subjects, width);
		const rowLines = (row: Row) => renderRow(row, layout, width, this.style);
		let opened = false;
		const open = () => {
			if (!opened && !this.atBlank) {
				this.print([""]);
			}
			opened = true;
		};
		return {
			row: (row) => {
				open();
				this.print(rowLines(row));
			},
			task: (progress) => {
				open();
				const spinning = this.spin((frame) =>
					renderProgress(progress, frame, layout, width, this.style),
				);
				return {
					settle: (row) => spinning.settle(rowLines(row)),
					clear: () => spinning.clear(),
				};
			},
		};
	}

	next(item: NextItem): void {
		this.queued.push(item);
	}

	close(tally: Tally): void {
		if (outcomeCount(tally) <= 1 && this.queued.length === 0) {
			return;
		}
		const width = this.width();
		this.print([
			...renderNext(this.queued.splice(0), width, this.style),
			...renderClose(
				tallyItems(tally),
				this.clock() - this.started,
				width,
				this.style,
			),
		]);
	}

	cancel(message: string): void {
		this.print(renderCancel(this.width(), this.style, message));
	}

	warn(message: Message): void {
		this.print(this.message("warn", message));
	}

	note(message: Message): void {
		this.print(this.message("note", message));
	}

	select<T>(prompt: SelectPrompt<T>): Promise<T | null> {
		return this.ask((context) => promptSelect(prompt, context));
	}

	multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]> {
		return this.ask((context) => promptMultiselect(prompt, context));
	}

	confirm(prompt: ConfirmPrompt): Promise<boolean> {
		return this.ask((context) => promptConfirm(prompt, context));
	}

	report(): void {}

	/**
	 * Whatever spins clears first; then the Next items queued so far, and the
	 * error under them, in either style.
	 */
	fail(message: Message, _options?: FailOptions): never {
		this.end();
		const next = renderNext(this.queued.splice(0), this.width(), this.style);
		this.print([
			...next,
			...(next.length > 0 ? [""] : []),
			...this.message("error", message),
		]);
		throw new ExitSignal(1);
	}

	/** The header stands for the title. */
	intro(_title: string): void {
		this.header();
	}

	outro(message: string): void {
		this.print(["", ...this.written(undefined, message)]);
	}

	box(message: string, title: string): void {
		this.print([
			...renderWritten(undefined, title, this.style, this.style.bold),
			...this.written(undefined, message),
		]);
	}

	spinner(): Spinner {
		let spinning: Spinning | undefined;
		return {
			start: (message = "") => {
				const width = this.width();
				const layout = blockLayout([], width);
				spinning ??= this.spin((frame) =>
					renderProgress({ text: message }, frame, layout, width, this.style),
				);
			},
			stop: (message, code = 0) => {
				const lines = message
					? this.written(code === 0 ? "done" : "failed", message)
					: [];
				if (spinning === undefined) {
					this.print(lines);
				} else {
					spinning.settle(lines);
					spinning = undefined;
				}
			},
		};
	}

	/**
	 * Ends the run's drawing: whatever still spins clears, and what it held
	 * prints. A task that finishes after this leaves no row.
	 */
	end(): void {
		const ended = this.live.splice(0);
		for (const live of ended) {
			this.pause(live);
		}
		this.write(ended.flatMap((live) => live.held));
	}

	private width(): number {
		return layoutWidth(this.output.columns);
	}

	/** A string as written, as every caller's is until its command moves over; a rich message laid out. */
	private message(kind: MessageKind, message: Message): string[] {
		if (typeof message !== "string") {
			return renderMessage(kind, message, this.width(), this.style);
		}
		const paint = kind === "error" ? this.style.bold : identity;
		return renderWritten(KIND_STATUS[kind], message, this.style, paint);
	}

	private written(status: Status | undefined, text: string): string[] {
		return renderWritten(status, text, this.style);
	}

	/** Held while a line spins, else written at once. */
	private print(lines: readonly string[]): void {
		const spinning = this.live.at(-1);
		if (spinning === undefined) {
			this.write(lines);
		} else {
			spinning.held.push(...lines);
		}
	}

	private write(lines: readonly string[]): void {
		if (lines.length === 0) {
			return;
		}
		this.output.write(lines.map((line) => `${line}\n`).join(""));
		this.atBlank = lines.at(-1) === "";
	}

	private spin(render: (frame: string) => string): Spinning {
		const under = this.live.at(-1);
		if (under !== undefined) {
			this.pause(under);
		}
		const live: Live = { render, held: [] };
		this.live.push(live);
		this.resume(live);
		return {
			settle: (lines) => this.finish(live, lines),
			clear: () => this.finish(live, []),
		};
	}

	/**
	 * The spinning line becomes `lines` and what it held, and the task it
	 * paused spins again. One that was paused prints them as any line is.
	 */
	private finish(live: Live, lines: readonly string[]): void {
		const index = this.live.indexOf(live);
		if (index === -1) {
			return;
		}
		this.live.splice(index, 1);
		const out = [...lines, ...live.held];
		if (live.task === undefined) {
			this.print(out);
			return;
		}
		live.task.settle(out);
		if (out.length > 0) {
			this.atBlank = out.at(-1) === "";
		}
		const under = this.live.at(-1);
		if (under !== undefined) {
			this.resume(under);
		}
	}

	private pause(live: Live): void {
		live.task?.clear();
		live.task = undefined;
	}

	private resume(live: Live): void {
		live.task ??= startTask(this.output, live.render, this.width(), {
			host: this.options.host,
		});
	}

	/** Pauses what spins and prints what it held, so the prompt draws alone; it spins again after. */
	private async ask<T>(
		prompt: (context: PromptContext) => Promise<T>,
	): Promise<T> {
		const spinning = this.live.at(-1);
		if (spinning !== undefined) {
			this.pause(spinning);
		}
		this.write(this.live.flatMap((live) => live.held.splice(0)));
		try {
			return await prompt(this.promptContext());
		} finally {
			if (spinning !== undefined && this.live.at(-1) === spinning) {
				this.resume(spinning);
			}
		}
	}

	private promptContext(): PromptContext {
		return {
			input: this.options.input ?? process.stdin,
			output: this.output,
			width: this.width(),
			style: this.style,
			host: this.options.host ?? process,
		};
	}
}
