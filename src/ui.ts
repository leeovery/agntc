import * as p from "@clack/prompts";
import { errorMessage } from "./errors.js";
import { ExitSignal } from "./exit-signal.js";

/**
 * Interactive: a person at a terminal, served by clack. Machine: no terminal,
 * or `--json`; nothing waits, and stdout carries one JSON document.
 */
export type Mode = "interactive" | "machine";

export type CommandName = "add" | "remove" | "update" | "list" | "init";

export interface Spinner {
	start(message?: string): void;
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

export interface SelectPrompt<T> {
	message: string;
	options: Choice<T>[];
	maxItems?: number;
}

export interface MultiselectPrompt<T> {
	message: string;
	options: Choice<T>[];
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
	/** How a terminal shows the failure: a cancel line (the default) or an error line. */
	style?: "cancel" | "error";
}

/**
 * Every user-facing word and question goes through here, so machine mode can
 * never reach clack.
 *
 * - `warn` and `note` reach the reader in both modes: a log line at a
 *   terminal, the document's `warnings` and `notes` in machine mode.
 * - `intro`, `outro`, `cancel`, `spinner`, `log` and `box` are what a person
 *   watches; machine mode drops them, and `report` carries the result instead.
 * - The prompts ask a person; in machine mode calling one fails the command.
 */
export interface Ui {
	readonly mode: Mode;
	readonly log: Log;

	warn(message: string): void;
	note(message: string): void;

	intro(title: string): void;
	outro(message: string): void;
	cancel(message: string): void;
	spinner(): Spinner;
	box(message: string, title: string): void;

	/** Resolves null when cancelled. */
	select<T>(prompt: SelectPrompt<T>): Promise<T | null>;
	/** Resolves empty when cancelled. */
	multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]>;
	/** Resolves false when cancelled. */
	confirm(prompt: ConfirmPrompt): Promise<boolean>;

	/** The command's result: machine mode's document body, unused at a terminal. */
	report(body: object): void;
	/** Ends the command with exit code 1. */
	fail(message: string, options?: FailOptions): never;
}

export const interactiveUi: Ui = {
	mode: "interactive",
	log: {
		info: (message) => p.log.info(message),
		warn: (message) => p.log.warn(message),
		error: (message) => p.log.error(message),
		success: (message) => p.log.success(message),
		message: (message) => p.log.message(message),
	},

	warn: (message) => p.log.warn(message),
	note: (message) => p.log.info(message),

	intro: (title) => p.intro(title),
	outro: (message) => p.outro(message),
	cancel: (message) => p.cancel(message),
	spinner: () => p.spinner(),
	box: (message, title) => p.note(message, title),

	async select<T>(prompt: SelectPrompt<T>): Promise<T | null> {
		const answer = await p.select<T>(prompt as p.SelectOptions<T>);
		return p.isCancel(answer) ? null : answer;
	},
	async multiselect<T>(prompt: MultiselectPrompt<T>): Promise<T[]> {
		const answer = await p.multiselect<T>(prompt as p.MultiSelectOptions<T>);
		return p.isCancel(answer) ? [] : answer;
	},
	async confirm(prompt: ConfirmPrompt): Promise<boolean> {
		const answer = await p.confirm(prompt);
		return !p.isCancel(answer) && answer === true;
	},

	report: () => {},
	fail(message, { style = "cancel" } = {}): never {
		if (style === "error") {
			p.log.error(message);
		} else {
			p.cancel(message);
		}
		throw new ExitSignal(1);
	},
};

export interface CommandError {
	message: string;
	flags?: string[];
}

/** What machine mode prints: one per command. `ok` is true exactly when the exit code is 0. */
export type MachineDocument = {
	ok: boolean;
	command: CommandName;
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

	constructor(private readonly command: CommandName) {}

	warn(message: string): void {
		this.warnings.push(message);
	}

	note(message: string): void {
		this.notes.push(message);
	}

	intro = ignore;
	outro = ignore;
	cancel = ignore;
	box = ignore;

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

	fail(message: string, { flags }: FailOptions = {}): never {
		this.error = { message, ...(flags !== undefined ? { flags } : {}) };
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
