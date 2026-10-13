import type { Command } from "commander";
import { type Mock, vi } from "vitest";
import type { MachineDocument } from "../../src/ui.js";

export interface MachineRun {
	/** Everything the command wrote to stdout. */
	stdout: string;
	/** The code passed to `process.exit`, or 0 when the command ran to its end. */
	exitCode: number;
	/** stdout parsed whole, which only succeeds when it holds one JSON document. */
	document: MachineDocument;
}

/**
 * Runs a commander command with `--json`, capturing stdout and the exit code
 * the way the CLI would see them.
 */
export async function runMachine(
	command: Command,
	args: string[],
): Promise<MachineRun> {
	const writes: string[] = [];
	const write = vi.spyOn(process.stdout, "write").mockImplementation(((
		chunk: unknown,
		encodingOrDone?: unknown,
		done?: unknown,
	) => {
		writes.push(String(chunk));
		const callback =
			typeof encodingOrDone === "function" ? encodingOrDone : done;
		if (typeof callback === "function") {
			callback();
		}
		return true;
	}) as typeof process.stdout.write);
	const exit = vi
		.spyOn(process, "exit")
		.mockImplementation((() => undefined) as never);

	let exitCode = 0;
	try {
		await command.parseAsync([...args, "--json"], { from: "user" });
		exitCode = (exit.mock.calls[0]?.[0] as number | undefined) ?? 0;
	} finally {
		write.mockRestore();
		exit.mockRestore();
	}

	const stdout = writes.join("");
	return { stdout, exitCode, document: JSON.parse(stdout) as MachineDocument };
}

/** Every call made to a mocked `@clack/prompts`, `log` methods included. */
export function clackCalls(clack: Record<string, unknown>): string[] {
	const called: string[] = [];
	for (const [name, member] of Object.entries(clack)) {
		if (vi.isMockFunction(member) && (member as Mock).mock.calls.length > 0) {
			called.push(name);
		}
		if (name === "log" && member !== null && typeof member === "object") {
			called.push(
				...clackCalls(member as Record<string, unknown>).map(
					(method) => `log.${method}`,
				),
			);
		}
	}
	return called;
}
