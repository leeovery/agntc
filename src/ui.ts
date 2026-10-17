import { errorMessage } from "./errors.js";
import { ExitSignal } from "./exit-signal.js";
import { type Message, plainText } from "./message.js";
import type { ScopeName } from "./scope.js";
import { TerminalUi } from "./terminal/terminal-ui.js";
import type {
	BlockSubject,
	NextItem,
	Progress,
	Row,
} from "./terminal/types.js";

/**
 * Interactive: a person at a terminal, drawn by agntc's renderer. Machine: no
 * terminal, or `--json`; nothing waits, and stdout carries one JSON document.
 */
export type Mode = "interactive" | "machine";

export type CommandName = "add" | "remove" | "update" | "list" | "init";

export interface Spinner {
	start(message?: string): void;
	/** Leaves `message` as a row, a done one for code 0 and a failed one for any other; with none, leaves nothing. */
	stop(message?: string, code?: number): void;
}

export interface Log {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	success(message: string): void;
	message(message: string): void;
}

export interface Choice<T> {
	value: T;
	label: string;
	hint?: string;
}

/** A bold heading over the choices after it, which the cursor passes over. */
export interface Heading {
	heading: string;
}

export type SelectOption<T> = Choice<T> | Heading;

export interface SelectPrompt<T> {
	message: string;
	options: SelectOption<T>[];
	maxItems?: number;
}

export interface MultiselectPrompt<T> {
	message: string;
	options: Choice<T>[];
	/** Whether enter waits until something is picked: no unless given. */
	required?: boolean;
}

export interface ConfirmPrompt {
	message: string;
	/** The answer the prompt starts on: yes unless given. */
	initialValue?: boolean;
}

export interface FailOptions {
	/** The flags that would have answered the question that couldn't be asked. */
	flags?: string[];
	/**
	 * The old look the failure asked for: a cancel line (the default) or an
	 * error line. A terminal now draws every failure as an error, so this goes
	 * with the old methods.
	 */
	style?: "cancel" | "error";
}

/** Rows streamed one at a time into columns fixed when the block opened. */
export interface Block {
	/** A finished row, and its children. */
	row(row: Row): void;
	/** A row that spins, saying what it's doing, until it settles or clears. */
	task(progress: Progress): BlockTask;
	/**
	 * Each asks about `row`, drawn over the question and erased with it, so
	 * what follows reports the outcome in its place, and resolves as the Ui's
	 * prompt of its kind does when cancelled.
	 */
	select<T>(row: Row, prompt: SelectPrompt<T>): Promise<T | null>;
	multiselect<T>(row: Row, prompt: MultiselectPrompt<T>): Promise<T[]>;
	confirm(row: Row, prompt: ConfirmPrompt): Promise<boolean>;
}

/** A step running in a block. A warning or note raised meanwhile prints under the row it settles into. */
export interface BlockTask {
	/** Becomes the finished row. */
	settle(row: Row): void;
	/** Leaves no row: progress that ends without one of its own. */
	clear(): void;
}

/** What update counts, each category naming the outcomes it takes in. */
export interface UpdateTally {
	/** Updated, or absorbed. */
	updated?: number;
	refreshed?: number;
	/** Up to date, pinned with newer tags included. */
	upToDate?: number;
	/** The check failed, or no tag is in range. */
	notChecked?: number;
	/** Aborted or blocked: the install is as it was. */
	notUpdated?: number;
	/** The copy or the clone failed. */
	failed?: number;
	/** Gone upstream, and removed. */
	removed?: number;
	/** Gone upstream, and kept. */
	kept?: number;
}

export interface AddTally {
	installed?: number;
	skipped?: number;
	failed?: number;
}

export interface RemoveTally {
	removed?: number;
	failed?: number;
}

/** What a list session changed. */
export interface ListTally {
	updated?: number;
	versionChanged?: number;
	removed?: number;
}

/** A run's outcomes, counted by its command's categories. */
export type Tally =
	| { command: "update"; counts: UpdateTally }
	| { command: "add"; counts: AddTally }
	| { command: "remove"; counts: RemoveTally }
	| { command: "list"; counts: ListTally };

/**
 * Every user-facing word and question goes through here, so machine mode
 * never draws.
 *
 * - `warn` and `note` reach the reader in both modes: a row at a terminal,
 *   the document's `warnings` and `notes` in machine mode.
 * - `header`, `block`, `next`, `close` and `cancel` are what a person
 *   watches; machine mode drops them, and `report` carries the result instead.
 * - The prompts ask a person; in machine mode calling one fails the command.
 * - `log`, `intro`, `outro`, `spinner` and `box` are the old surface, drawn
 *   as plain rows until each command moves off them.
 */
export interface Ui {
	readonly mode: Mode;

	/** Opens the run with its header line, once however often it's called. */
	header(): void;
	/** Opens a block, its columns fixed from every subject it will hold. */
	block(subjects: readonly BlockSubject[]): Block;
	/** Queues a remedy for the Next section the run closes with. */
	next(item: NextItem): void;
	/**
	 * Closes the run. More than one outcome, or anything queued, gives the
	 * Next section, a rule and the tally; with no outcome, Next alone, as
	 * there's nothing to count; otherwise the run ends on its row.
	 */
	close(tally: Tally): void;
	cancel(message: string): void;

	warn(message: Message): void;
	note(message: Message): void;

	/** Resolves null when cancelled. */
	select<T>(prompt: SelectPrompt<T>): Promise<T | null>;
	/** Resolves empty when cancelled. */
	multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]>;
	/** Resolves false when cancelled. */
	confirm(prompt: ConfirmPrompt): Promise<boolean>;

	/** The command's result: machine mode's document body, unused at a terminal. */
	report(body: object): void;
	/** Ends the command with exit code 1, after the Next items queued so far. */
	fail(message: Message, options?: FailOptions): never;

	readonly log: Log;
	intro(title: string): void;
	outro(message: string): void;
	spinner(): Spinner;
	box(message: string, title: string): void;
}

/** A fresh terminal Ui, with no header, for a command run without one. */
export function interactiveUi(): Ui {
	return new TerminalUi();
}

/**
 * `ui`, its `fail` and `cancel` first calling `stop`: whatever ends the run
 * through it, however deep in a step, draws what the run owes the reader
 * above the line that ends it.
 */
export function stoppingUi(ui: Ui, stop: () => void): Ui {
	const fail: Ui["fail"] = (message, options) => {
		stop();
		return ui.fail(message, options);
	};
	const cancel: Ui["cancel"] = (message) => {
		stop();
		ui.cancel(message);
	};
	return new Proxy(ui, {
		get(target, key) {
			if (key === "fail") {
				return fail;
			}
			if (key === "cancel") {
				return cancel;
			}
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export interface CommandError {
	message: string;
	flags?: string[];
}

/**
 * What machine mode prints: one per command. `ok` is true exactly when the
 * exit code is 0. A command that takes `-g` names its scope.
 */
export type MachineDocument = {
	ok: boolean;
	command: CommandName;
	scope?: ScopeName;
	error?: CommandError;
	warnings: string[];
	notes: string[];
} & Record<string, unknown>;

const ignore = (): void => {};
const silentSpinner: Spinner = { start: ignore, stop: ignore };

export class MachineUi implements Ui {
	readonly mode = "machine";
	readonly log: Log = {
		info: ignore,
		warn: ignore,
		error: ignore,
		success: ignore,
		message: ignore,
	};
	private readonly warnings: string[] = [];
	private readonly notes: string[] = [];
	private body: object = {};
	private error: CommandError | undefined;

	constructor(
		private readonly command: CommandName,
		private readonly scope?: ScopeName,
	) {}

	warn(message: Message): void {
		this.warnings.push(plainText(message));
	}

	note(message: Message): void {
		this.notes.push(plainText(message));
	}

	header = ignore;
	next = ignore;
	close = ignore;
	intro = ignore;
	outro = ignore;
	cancel = ignore;
	box = ignore;

	/** Draws nothing; asking about a row fails as any prompt does. */
	block(): Block {
		return {
			row: ignore,
			task: () => ({ settle: ignore, clear: ignore }),
			select: (_row, prompt) => this.select(prompt),
			multiselect: (_row, prompt) => this.multiselect(prompt),
			confirm: (_row, prompt) => this.confirm(prompt),
		};
	}

	spinner(): Spinner {
		return silentSpinner;
	}

	async select<T>(prompt: SelectPrompt<T>): Promise<T | null> {
		return this.cannotAsk(prompt.message);
	}

	async multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]> {
		return this.cannotAsk(prompt.message);
	}

	async confirm(prompt: ConfirmPrompt): Promise<boolean> {
		return this.cannotAsk(prompt.message);
	}

	report(body: object): void {
		this.body = body;
	}

	fail(message: Message, { flags }: FailOptions = {}): never {
		this.error = {
			message: plainText(message),
			...(flags !== undefined ? { flags } : {}),
		};
		throw new ExitSignal(1);
	}

	/**
	 * The document for a command that ended with `exitCode`. A `crash` is an
	 * error the command didn't catch; it becomes the document's error.
	 */
	document(exitCode: number, crash?: unknown): MachineDocument {
		const error =
			crash === undefined ? this.error : { message: errorMessage(crash) };
		return {
			ok: exitCode === 0,
			command: this.command,
			...(this.scope !== undefined ? { scope: this.scope } : {}),
			...(error !== undefined ? { error } : {}),
			...this.body,
			warnings: this.warnings,
			notes: this.notes,
		};
	}

	private cannotAsk(question: string): never {
		return this.fail(`can't ask "${question}" without a terminal`);
	}
}
