import { renderCancel } from "./close.js";
import {
	CLEAR_LINE,
	type ExitHost,
	HIDE_CURSOR,
	restoreOnExit,
	SHOW_CURSOR,
} from "./control.js";
import { truncate } from "./layout.js";
import { createStyle, type Style } from "./style.js";

const FRAMES = "⠁⠂⠄⡀⢀⠠⠐⠈";
const FRAME_MS = 80;

export interface TaskOutput {
	write(text: string): unknown;
}

/** The process a task restores the cursor on exit of; tests pass their own. */
export type TaskHost = ExitHost;

export interface TaskOptions {
	host?: TaskHost;
	/** Paints the dim ` ○ Cancelled` a signal leaves where the task spun; no colour unless given. */
	style?: Style;
}

const PLAIN = createStyle(0);

export interface Task {
	/** Replaces the spinning line with `lines`, showing the cursor once no task spins on the output. */
	settle(lines: readonly string[]): void;
	/** Erases the spinning line, showing the cursor once no task spins on the output. */
	clear(): void;
}

/**
 * Spins `render(frame)` on one line until the task settles or clears, the
 * cursor hidden meanwhile. Each frame is cut to `width - 1` columns, as
 * `\r\x1b[2K` erases one row only. A render that throws ends the task first,
 * so nothing is left registered or hidden. The process exiting meanwhile
 * erases the line; a SIGINT or SIGTERM leaves ` ○ Cancelled` there.
 */
export function startTask(
	out: TaskOutput,
	render: (frame: string) => string,
	width: number,
	options: TaskOptions = {},
): Task {
	let frame = 0;
	const line = () => {
		const [first = ""] = render(FRAMES.charAt(frame % FRAMES.length)).split(
			"\n",
		);
		return `${CLEAR_LINE}${truncate(first, width - 1)}`;
	};
	const opening = line();
	const cancelled = renderCancel(width, options.style ?? PLAIN).join("\n");
	const release = track(options.host ?? process, out, cancelled);
	out.write(`${HIDE_CURSOR}${opening}`);

	let finished = false;
	const finish = (text: string) => {
		if (finished) {
			return;
		}
		finished = true;
		clearInterval(timer);
		out.write(`${CLEAR_LINE}${text}${release() ? SHOW_CURSOR : ""}`);
	};
	const timer = setInterval(() => {
		frame += 1;
		try {
			out.write(line());
		} catch (error) {
			finish("");
			throw error;
		}
	}, FRAME_MS);
	return {
		settle: (lines) => finish(lines.map((text) => `${text}\n`).join("")),
		clear: () => finish(""),
	};
}

/** How many tasks spin on an output, and what a signal leaves on it: its newest task's cancel line. */
interface Spinning {
	tasks: number;
	cancelled: string;
}

/** The tasks spinning on each of a host's outputs, and how to stop watching the host. */
interface Registration {
	spinning: Map<TaskOutput, Spinning>;
	stopWatching: () => void;
}

const registrations = new Map<TaskHost, Registration>();

/**
 * Counts a task on its host and output, adding the host's handlers with its
 * first task. The release says whether the output has no task left, and
 * takes the handlers off with the host's last.
 */
function track(
	host: TaskHost,
	out: TaskOutput,
	cancelled: string,
): () => boolean {
	const registration = registrations.get(host) ?? register(host);
	const { spinning } = registration;
	spinning.set(out, { tasks: (spinning.get(out)?.tasks ?? 0) + 1, cancelled });
	return () => {
		const current = spinning.get(out);
		if (current !== undefined && current.tasks > 1) {
			current.tasks -= 1;
			return false;
		}
		spinning.delete(out);
		if (spinning.size === 0) {
			unregister(host, registration);
		}
		return true;
	};
}

/** An exit erases the spinning line; a signal leaves the cancel line in its place. */
function register(host: TaskHost): Registration {
	const spinning = new Map<TaskOutput, Spinning>();
	const registration: Registration = {
		spinning,
		stopWatching: restoreOnExit(host, (event) => {
			for (const [out, { cancelled }] of spinning) {
				const left = event === "exit" ? "" : `${cancelled}\n`;
				out.write(`${CLEAR_LINE}${left}${SHOW_CURSOR}`);
			}
		}),
	};
	registrations.set(host, registration);
	return registration;
}

function unregister(host: TaskHost, registration: Registration): void {
	registration.stopWatching();
	registrations.delete(host);
}
