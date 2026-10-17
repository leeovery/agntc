/** The cursor and erase sequences the renderer writes. */
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
/** Erases the cursor's line, the cursor staying where it is. */
export const ERASE_LINE = "\x1b[2K";
/** Back to the start of the line, erasing it. */
export const CLEAR_LINE = `\r${ERASE_LINE}`;
/** Erases from the cursor to the end of the screen. */
export const ERASE_DOWN = "\x1b[J";

/** What a run hears from its process: its exit, and the signals the run owns. */
export type HostEvent = "exit" | "SIGINT" | "SIGTERM" | "SIGTSTP";

/** The process a run's signals reach, which it exits and stops; tests pass their own. */
export interface SignalHost {
	on(event: HostEvent, listener: () => void): unknown;
	off(event: HostEvent, listener: () => void): unknown;
	exit(code: number): void;
	kill(pid: number, signal: "SIGTSTP"): unknown;
}

/** What a run does as its process exits, is interrupted or is suspended. */
export interface SignalHandlers {
	/** The process exiting under the run: the terminal put back, and nothing more. */
	exit(): void;
	/** A SIGINT or SIGTERM, after which the process exits. */
	interrupt(): void;
	/** A SIGTSTP. */
	suspend(): void;
}

/**
 * A run's hold on its process's signals, from `watch` to `unwatch`: the
 * process exiting goes to `exit`; a SIGINT or SIGTERM to `interrupt`, then
 * the watch ends and the process exits with the code a shell reports for
 * the signal (130, 143); a SIGTSTP to `suspend`.
 */
export class RunSignals {
	private readonly suspend: () => void;
	private readonly listeners: readonly (readonly [HostEvent, () => void])[];
	private watching = false;

	constructor(
		private readonly host: SignalHost,
		handlers: SignalHandlers,
	) {
		const interrupted = (code: number) => () => {
			handlers.interrupt();
			this.unwatch();
			host.exit(code);
		};
		this.suspend = () => handlers.suspend();
		this.listeners = [
			["exit", () => handlers.exit()],
			["SIGINT", interrupted(130)],
			["SIGTERM", interrupted(143)],
			["SIGTSTP", this.suspend],
		];
	}

	watch(): void {
		if (!this.watching) {
			this.watching = true;
			for (const [event, listener] of this.listeners) {
				this.host.on(event, listener);
			}
		}
	}

	unwatch(): void {
		if (this.watching) {
			this.watching = false;
			for (const [event, listener] of this.listeners) {
				this.host.off(event, listener);
			}
		}
	}

	/**
	 * Stops the whole process group, as a terminal's ^Z stops it, so a parent
	 * such as npx's `sh -c` stops too and the shell sees the job stop. The
	 * watch lets SIGTSTP go meanwhile, so the signal takes its default action:
	 * the kill returns once the job is continued, or at once where the stop
	 * is ignored (an orphaned group). A SIGINT or SIGTERM sent while it's
	 * stopped is still the watch's once it goes on.
	 */
	stopGroup(): void {
		const watching = this.watching;
		if (watching) {
			this.host.off("SIGTSTP", this.suspend);
		}
		this.host.kill(0, "SIGTSTP");
		if (watching) {
			this.host.on("SIGTSTP", this.suspend);
		}
	}
}
