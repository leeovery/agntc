import { homedir } from "node:os";
import { type Command, Option } from "commander";
import { ExitSignal } from "./exit-signal.js";
import { globalScope, projectScope, type Scope, scopeWhere } from "./scope.js";
import { TerminalUi } from "./terminal/terminal-ui.js";
import type { Header } from "./terminal/types.js";
import { type CommandName, MachineUi, type Mode, type Ui } from "./ui.js";
import { BANNER_VERSION } from "./version.js";

export interface ModeInput {
	json: boolean;
	stdinIsTTY: boolean;
	stdoutIsTTY: boolean;
}

/** Machine mode when `--json` is given or either end of the pipe isn't a terminal. */
export function resolveMode({
	json,
	stdinIsTTY,
	stdoutIsTTY,
}: ModeInput): Mode {
	return json || !stdinIsTTY || !stdoutIsTTY ? "machine" : "interactive";
}

/** `-g` roots the command at the home directory; otherwise at the working directory. */
export function resolveScope(
	global: boolean,
	io: Pick<CommandIo, "cwd" | "homedir">,
): Scope {
	return global ? globalScope(io.homedir()) : projectScope(io.cwd());
}

/** The process a command runs in: injectable so tests can stand in for it. */
export interface CommandIo {
	stdinIsTTY(): boolean;
	stdoutIsTTY(): boolean;
	cwd(): string;
	homedir(): string;
	/** Resolves once the text is flushed, so exiting straight after can't cut it short. */
	write(text: string): Promise<void>;
	exit(code: number): void;
	/** The Ui a terminal run draws on, opening with `header`. */
	terminalUi(header: Header): TerminalUi;
}

export const processIo: CommandIo = {
	stdinIsTTY: () => process.stdin.isTTY === true,
	stdoutIsTTY: () => process.stdout.isTTY === true,
	cwd: () => process.cwd(),
	homedir: () => homedir(),
	write: (text) =>
		new Promise((resolve) => {
			process.stdout.write(text, () => resolve());
		}),
	exit: (code) => process.exit(code),
	terminalUi: (header) => new TerminalUi({ header }),
};

export function jsonOption(): Option {
	return new Option(
		"--json",
		"Print one JSON document instead of the interactive output",
	);
}

export function globalOption(): Option {
	return new Option(
		"-g, --global",
		"Work on the installs in your home folder (~/.claude) instead of this project's",
	);
}

type Run<A extends unknown[]> = (
	ui: Ui,
	scope: Scope,
	...args: A
) => Promise<void>;

/**
 * A commander action that resolves the mode and the scope once and runs the
 * command with the matching {@link Ui}. A terminal run opens with its header;
 * machine mode gets exactly one JSON document on stdout, whatever happens. An
 * {@link ExitSignal} sets the exit code.
 */
export function commandAction<A extends unknown[]>(
	name: CommandName,
	run: Run<A>,
	io: CommandIo = processIo,
): (this: Command, ...args: A) => Promise<void> {
	return async function (this: Command, ...args: A): Promise<void> {
		const options = this.opts();
		const mode = resolveMode({
			json: options.json === true,
			stdinIsTTY: io.stdinIsTTY(),
			stdoutIsTTY: io.stdoutIsTTY(),
		});
		const scope = resolveScope(options.global === true, io);
		const start = (ui: Ui) => run(ui, scope, ...args);
		const exitCode =
			mode === "machine"
				? await runMachine(machineUi(name, scope, this), start, io)
				: await runInteractive(
						io.terminalUi({
							command: name,
							where: scopeWhere(scope, io.homedir()),
							version: BANNER_VERSION,
						}),
						start,
					);
		if (exitCode !== null) {
			io.exit(exitCode);
		}
	};
}

/** The signalled exit code, or null when the command ran to its end. */
type ExitCode = number | null;

/** The header first; whatever still spins at the end, however it ends, clears. */
async function runInteractive(
	ui: TerminalUi,
	start: (ui: Ui) => Promise<void>,
): Promise<ExitCode> {
	ui.header();
	try {
		await start(ui);
		return null;
	} catch (err) {
		if (err instanceof ExitSignal) {
			return err.code;
		}
		throw err;
	} finally {
		ui.end();
	}
}

/** A command that takes `-g` names its scope in its document; `init` has none. */
function machineUi(
	name: CommandName,
	scope: Scope,
	command: Command,
): MachineUi {
	const scoped = command.options.some(({ long }) => long === "--global");
	return new MachineUi(name, scoped ? scope.name : undefined);
}

async function runMachine(
	ui: MachineUi,
	start: (ui: Ui) => Promise<void>,
	io: CommandIo,
): Promise<ExitCode> {
	let exitCode: ExitCode = null;
	let crash: unknown;
	try {
		await start(ui);
	} catch (err) {
		exitCode = err instanceof ExitSignal ? err.code : 1;
		crash = err instanceof ExitSignal ? undefined : err;
	}
	const document = ui.document(exitCode ?? 0, crash);
	await io.write(`${JSON.stringify(document, null, 2)}\n`);
	return exitCode;
}
