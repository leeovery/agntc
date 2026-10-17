import { ExitSignal } from "../exit-signal.js";
import { isMachineOnly, type Message } from "../message.js";
import type {
	Asked,
	Block,
	ConfirmPrompt,
	MultiselectPrompt,
	SelectPrompt,
	Tally,
	Ui,
} from "../ui.js";
import {
	blockLayout,
	renderProgress,
	renderRow,
	renderRowsWithin,
	renderRowWithin,
} from "./block.js";
import { renderCancel, renderClose } from "./close.js";
import { RunSignals, type SignalHost } from "./control.js";
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
import type {
	OpenPrompt,
	PromptContext,
	PromptOutput,
	PromptOwner,
} from "./prompts/session.js";
import { createStyle, detectColorLevel, type Style } from "./style.js";
import { outcomeCount, tallyItems } from "./tally.js";
import { startTask, type Task } from "./task.js";
import type { BlockSubject, Header, NextItem, Row } from "./types.js";

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
	/** The process whose SIGINT, SIGTERM and SIGTSTP the run owns from `begin` to `end`, and whose exit puts the terminal back. */
	host?: SignalHost;
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
 * - From `begin` to `end` the run owns the process's SIGINT, SIGTERM and
 *   SIGTSTP, wherever it is: spinning, asking or between.
 */
export class TerminalUi implements Ui {
	readonly mode = "interactive";
	private readonly options: TerminalUiOptions;
	private readonly output: TerminalOutput;
	private readonly style: Style;
	private readonly clock: () => number;
	private readonly started: number;
	private readonly signals: RunSignals;
	private readonly queued: NextItem[] = [];
	/** The newest last, the one spinning. */
	private readonly live: Live[] = [];
	/** What's printed while a prompt asks. */
	private readonly answered: string[] = [];
	private asking = false;
	/** The prompt on screen, for a signal to erase. */
	private openPrompt?: OpenPrompt;
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
		this.signals = new RunSignals(options.host ?? process, {
			exit: () => {
				this.clearScreen();
				this.restore();
			},
			interrupt: () => this.interrupt(),
			suspend: () => this.suspend(),
		});
	}

	/** Takes the process's signals for the run, until it ends. */
	begin(): void {
		this.signals.watch();
	}

	header(): void {
		const { header } = this.options;
		if (this.headed || header === undefined) {
			return;
		}
		this.headed = true;
		this.print([...renderHeader(header, this.width(), this.style), ""]);
	}

	/** A block after other lines opens a blank line below them as it first draws; a question asked before then carries that line in its frame. */
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
			asked: Asked,
			prompt: (
				above: (room: number) => string[],
				context: PromptContext,
			) => Promise<A>,
		): Promise<A> => {
			const within = (room: number) =>
				"subject" in asked
					? renderRowWithin(asked, room, layout, width, this.style)
					: renderRowsWithin(asked, room, layout, width, this.style);
			// Until the block draws, the blank line it opens with is the
			// question's, and goes with it: a block that only asks leaves nothing.
			const above = (room: number) => {
				const opening = opened ? [] : this.opening();
				const lines = within(room - 1 - opening.length);
				return lines.length === 0 ? opening : [...opening, ...lines, ""];
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
			select: (asked, prompt) =>
				askAbout(asked, (above, context) =>
					promptSelect({ ...prompt, above }, context),
				),
			multiselect: (asked, prompt) =>
				askAbout(asked, (above, context) =>
					promptMultiselect({ ...prompt, above }, context),
				),
			confirm: (asked, prompt) =>
				askAbout(asked, (above, context) =>
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

	/** ` ○ Cancelled`, or `message` in its place. */
	cancel(message?: string): void {
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

	/** A question after other lines carries the blank line below them in its frame, as a block's does. */
	select<T>(prompt: SelectPrompt<T>): Promise<T | null> {
		return this.ask((context) =>
			promptSelect({ ...prompt, above: this.opening }, context),
		);
	}

	multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]> {
		return this.ask((context) =>
			promptMultiselect({ ...prompt, above: this.opening }, context),
		);
	}

	confirm(prompt: ConfirmPrompt): Promise<boolean> {
		return this.ask((context) =>
			promptConfirm({ ...prompt, above: this.opening }, context),
		);
	}

	report(): void {}

	/**
	 * Whatever spins clears first, and what it held prints; then the Next
	 * items queued so far, and the error under them, a blank line over it so
	 * it doesn't read as part of what's above.
	 */
	fail(message: Message): never {
		this.stopSpinning();
		this.printSection([
			...this.takeNext(),
			"",
			...this.message("error", message),
		]);
		throw new ExitSignal(1);
	}

	/**
	 * Ends the run's drawing: whatever still spins clears, what it held
	 * prints, and then the Next items still queued, so a remedy is never lost.
	 * A task that finishes after this leaves no row. The process's signals
	 * are its own again.
	 */
	end(): void {
		this.drain();
		this.signals.unwatch();
	}

	private drain(): void {
		this.stopSpinning();
		this.printSection(this.takeNext());
	}

	/**
	 * A SIGINT or SIGTERM ends the run where it stands, in one go: what spins
	 * clears and an open prompt is erased; what was printed while it asked,
	 * and what's held, print with the Next items, as `end` prints them; then
	 * ` ○ Cancelled`, and the terminal goes back to the shell. No rule or
	 * tally: a signal isn't a close.
	 */
	private interrupt(): void {
		this.clearScreen();
		this.asking = false;
		this.write(this.answered.splice(0));
		this.drain();
		this.cancel();
		this.restore();
	}

	/**
	 * A SIGTSTP, or a prompt's ctrl-z: the terminal goes back to the shell and
	 * the whole process group stops, as a terminal's ^Z stops it. Once it's
	 * continued, what spun spins again, or the prompt is drawn again.
	 */
	private suspend(): void {
		this.clearScreen();
		this.restore();
		this.signals.stopGroup();
		this.openPrompt?.resume();
		this.resumeTop();
	}

	/** The spinning line cleared, or the open prompt's frame erased. */
	private clearScreen(): void {
		const top = this.live.at(-1);
		if (top !== undefined) {
			this.pause(top);
		}
		this.openPrompt?.erase();
	}

	/**
	 * The terminal as the shell wants it: raw mode off and the cursor shown.
	 * Only a prompt holds raw mode, and a spinning line shows the cursor as
	 * it clears, so this is the open prompt's to do.
	 */
	private restore(): void {
		this.openPrompt?.cook();
	}

	/** The run's side of a prompt: what it holds while open, and its ctrl-z. */
	private readonly owner: PromptOwner = {
		hold: (prompt) => {
			this.openPrompt = prompt;
			return () => {
				if (this.openPrompt === prompt) {
					this.openPrompt = undefined;
				}
			};
		},
		suspend: () => this.suspend(),
	};

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

	/** The blank line a section opens with, none where the line above is blank already. */
	private readonly opening = (): string[] => (this.endsBlank() ? [] : [""]);

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
		live.task ??= startTask(this.output, live.render, this.width());
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
			owner: this.owner,
		};
	}
}
