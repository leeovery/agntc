/** The cursor and erase sequences the renderer writes. */
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
/** Erases the cursor's line, the cursor staying where it is. */
export const ERASE_LINE = "\x1b[2K";
/** Back to the start of the line, erasing it. */
export const CLEAR_LINE = `\r${ERASE_LINE}`;
/** Erases from the cursor to the end of the screen. */
export const ERASE_DOWN = "\x1b[J";

type ExitEvent = "exit" | "SIGINT" | "SIGTERM";

/** The process whose ending restores the terminal; tests pass their own. */
export interface ExitHost {
	on(event: ExitEvent, listener: () => void): unknown;
	off(event: ExitEvent, listener: () => void): unknown;
	exit(code: number): void;
}

/**
 * Runs `restore` when the process exits, and on SIGINT or SIGTERM, which then
 * end it with the code a shell reports for them (130, 143). The return stops
 * watching.
 */
export function restoreOnExit(host: ExitHost, restore: () => void): () => void {
	const exitWith = (code: number) => () => {
		restore();
		host.exit(code);
	};
	const handlers: [ExitEvent, () => void][] = [
		["exit", restore],
		["SIGINT", exitWith(130)],
		["SIGTERM", exitWith(143)],
	];
	for (const [event, handler] of handlers) {
		host.on(event, handler);
	}
	return () => {
		for (const [event, handler] of handlers) {
			host.off(event, handler);
		}
	};
}
