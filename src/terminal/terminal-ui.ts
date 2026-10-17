import { ExitSignal } from "../exit-signal.js";
import { isMachineOnly, type Message } from "../message.js";
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
import {
	blockLayout,
	renderProgress,
	renderRow,
	renderRowWithin,
} from "./block.js";
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
import { createStyle, detectColorLevel, type Style } from "./style.js";
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
 * A command run at a terminal, drawn by the renderer.
 *
 * - One line spins at a time, the newest task's: a task started under
 *   another pauses it until it ends.
 * - What's printed while a task spins prints under the lines it settles
 *   into; rows print in the order their tasks settle, so a task that settles
 *   under a newer one writes above its spinning line.
 * - A prompt draws alone: what spins pauses, what it held prints above the
 *   prompt, and what's printed while it asks waits for its answer.
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
	/** What's printed while a prompt asks. */
	private readonly answered: string[] = [];
	private asking = false;
	private headed = false;
	/** Whether the last line written is blank; so it is before any is, and a first section opens without one. */
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

	/** A block after other lines opens a blank line below them, as it first draws or asks. */
	block(subjects: readonly BlockSubject[]): Block {
		const width = this.width();
		const layout = blockLayout(subjects, width);
		const rowLines = (row: Row) => renderRow(row, layout, width, this.style);
		let opened = false;
		const open = () => {
			if (!opened) {
				opened = true;
				this.printSection([""]);
			}
		};
		const askAbout = <A>(
			row: Row,
			prompt: (
				above: (room: number) => string[],
				context: PromptContext,
			) => Promise<A>,
		): Promise<A> => {
			open();
			const above = (room: number) => {
				const lines = renderRowWithin(row, room - 1, layout, width, this.style);
				return lines.length === 0 ? [] : [...lines, ""];
			};
			return this.ask((context) => prompt(above, context));
		};
		return {
			row: (row) => {
				open();
				this.print(rowLines(row));
			},
			task: (progress) => {
				open();
				const spinning = this.spin((frame) =>
					renderProgress(progress, frame, width, this.style, layout),
				);
				return {
					settle: (row) => spinning.settle(rowLines(row)),
					clear: () => spinning.clear(),
				};
			},
			select: (row, prompt) =>
				askAbout(row, (above, context) =>
					promptSelect({ ...prompt, above }, context),
				),
			multiselect: (row, prompt) =>
				askAbout(row, (above, context) =>
					promptMultiselect({ ...prompt, above }, context),
				),
			confirm: (row, prompt) =>
				askAbout(row, (above, context) =>
					promptConfirm({ ...prompt, above }, context),
				),
		};
	}

	next(item: NextItem): void {
		this.queued.push(item);
	}

	close(tally: Tally): void {
		const outcomes = outcomeCount(tally);
		if (outcomes <= 1 && this.queued.length === 0) {
			return;
		}
		if (outcomes === 0) {
			this.printSection(this.takeNext());
			return;
		}
		this.printSection([
			...this.takeNext(),
			...renderClose(
				tallyItems(tally),
				this.clock() - this.started,
				this.width(),
				this.style,
			),
		]);
	}

	cancel(message: string): void {
		this.printSection(["", ...renderCancel(this.width(), this.style, message)]);
	}

	warn(message: Message): void {
		if (!isMachineOnly(message)) {
			this.print(this.message("warn", message));
		}
	}

	note(message: Message): void {
		if (!isMachineOnly(message)) {
			this.print(this.message("note", message));
		}
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
	 * Whatever spins clears first, and what it held prints; then the Next
	 * items queued so far, and the error under them, in either style, a blank
	 * line over it so it doesn't read as part of what's above.
	 */
	fail(message: Message, _options?: FailOptions): never {
		this.stopSpinning();
		this.printSection([
			...this.takeNext(),
			"",
			...this.message("error", message),
		]);
		throw new ExitSignal(1);
	}

	/** The header stands for the title. */
	intro(_title: string): void {
		this.header();
	}

	outro(message: string): void {
		this.printSection(["", ...this.written(undefined, message)]);
	}

	box(message: string, title: string): void {
		this.print([
			...renderWritten(undefined, title, this.style, {
				first: this.style.bold,
			}),
			...this.written(undefined, message),
		]);
	}

	/** Once stopped, a stop does nothing until it starts again; a start while it spins changes what it says. */
	spinner(): Spinner {
		let message = "";
		let spinning: Spinning | undefined;
		let stopped = false;
		return {
			start: (text = "") => {
				message = text;
				stopped = false;
				spinning ??= this.spin((frame) =>
					renderProgress({ text: message }, frame, this.width(), this.style),
				);
			},
			stop: (text, code = 0) => {
				if (stopped) {
					return;
				}
				stopped = true;
				const lines = text
					? this.written(code === 0 ? "done" : "failed", text)
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
	 * Ends the run's drawing: whatever still spins clears, what it held
	 * prints, and then the Next items still queued, so a remedy is never lost.
	 * A task that finishes after this leaves no row.
	 */
	end(): void {
		this.stopSpinning();
		this.printSection(this.takeNext());
	}

	private stopSpinning(): void {
		const ended = this.live.splice(0);
		for (const live of ended) {
			this.pause(live);
		}
		this.write(ended.flatMap((live) => live.held));
	}

	private takeNext(): string[] {
		return renderNext(this.queued.splice(0), this.width(), this.style);
	}

	private width(): number {
		return layoutWidth(this.output.columns);
	}

	/**
	 * A string as written, an error's first line bold and the rest, its
	 * cause, dim; a rich message laid out.
	 */
	private message(kind: MessageKind, message: Message): string[] {
		if (typeof message !== "string") {
			return renderMessage(kind, message, this.width(), this.style);
		}
		const paint =
			kind === "error"
				? { first: this.style.bold, rest: this.style.dim }
				: undefined;
		return renderWritten(KIND_STATUS[kind], message, this.style, paint);
	}

	private written(status: Status | undefined, text: string): string[] {
		return renderWritten(status, text, this.style);
	}

	/** Where a printed line waits: for the prompt's answer, or for the spinning task to settle. */
	private pending(): string[] | undefined {
		return this.asking ? this.answered : this.live.at(-1)?.held;
	}

	private print(lines: readonly string[]): void {
		const pending = this.pending();
		if (pending === undefined) {
			this.write(lines);
		} else {
			pending.push(...lines);
		}
	}

	/** `lines`, the blank line they open with left off where the line above them is blank already. */
	private printSection(lines: readonly string[]): void {
		this.print(lines[0] === "" && this.endsBlank() ? lines.slice(1) : lines);
	}

	/**
	 * Whether the next line printed lands under a blank one: the last line
	 * still waiting, else the last written. A spinning task's row will sit
	 * above what it holds.
	 */
	private endsBlank(): boolean {
		const pending = this.pending() ?? [];
		if (pending.length > 0) {
			return pending.at(-1) === "";
		}
		return (this.asking || this.live.length === 0) && this.atBlank;
	}

	private write(lines: readonly string[]): void {
		if (lines.length > 0) {
			this.output.write(lines.map((line) => `${line}\n`).join(""));
			this.wrote(lines);
		}
	}

	private wrote(lines: readonly string[]): void {
		if (lines.length > 0) {
			this.atBlank = lines.at(-1) === "";
		}
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
	 * `lines` and what the task held, where its spinning line was; the task
	 * it paused spins again. A paused one's go above the line spinning now,
	 * or wait for a prompt's answer.
	 */
	private finish(live: Live, lines: readonly string[]): void {
		const index = this.live.indexOf(live);
		if (index === -1) {
			return;
		}
		this.live.splice(index, 1);
		const out = [...lines, ...live.held];
		if (live.task !== undefined) {
			live.task.settle(out);
			this.wrote(out);
		} else if (this.asking) {
			this.answered.push(...out);
			return;
		} else {
			this.writeAbove(out);
		}
		this.resumeTop();
	}

	/** Clears the spinning line, writes `lines`, and draws it again under them. */
	private writeAbove(lines: readonly string[]): void {
		const top = this.live.at(-1);
		if (top !== undefined) {
			this.pause(top);
		}
		this.write(lines);
	}

	private pause(live: Live): void {
		live.task?.clear();
		live.task = undefined;
	}

	/** The newest task spins, unless a prompt is asking. */
	private resumeTop(): void {
		const top = this.live.at(-1);
		if (top !== undefined) {
			this.resume(top);
		}
	}

	private resume(live: Live): void {
		if (this.asking) {
			return;
		}
		live.task ??= startTask(this.output, live.render, this.width(), {
			host: this.options.host,
			style: this.style,
		});
	}

	private async ask<T>(
		prompt: (context: PromptContext) => Promise<T>,
	): Promise<T> {
		const top = this.live.at(-1);
		if (top !== undefined) {
			this.pause(top);
		}
		this.write(this.live.flatMap((live) => live.held.splice(0)));
		this.asking = true;
		try {
			return await prompt(this.promptContext());
		} finally {
			this.asking = false;
			this.write(this.answered.splice(0));
			this.resumeTop();
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
