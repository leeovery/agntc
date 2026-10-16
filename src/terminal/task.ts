import {
	CLEAR_LINE,
	type ExitHost,
	HIDE_CURSOR,
	restoreOnExit,
	SHOW_CURSOR,
} from "./control.js";
import { truncate } from "./layout.js";

const FRAMES = "⠁⠂⠄⡀⢀⠠⠐⠈";
const FRAME_MS = 80;

export interface TaskOutput {
	write(text: string): unknown;
}

/** The process a task restores the cursor on exit of; tests pass their own. */
export type TaskHost = ExitHost;

export interface TaskOptions {
	host?: TaskHost;
}

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
 * so nothing is left registered or hidden.
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
	const release = track(options.host ?? process, out);
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

/** The tasks spinning on each of a host's outputs, and how to stop watching the host. */
interface Registration {
	spinning: Map<TaskOutput, number>;
	stopWatching: () => void;
}

const registrations = new Map<TaskHost, Registration>();

/**
 * Counts a task on its host and output, adding the host's handlers with its
 * first task. The release says whether the output has no task left, and
 * takes the handlers off with the host's last.
 */
function track(host: TaskHost, out: TaskOutput): () => boolean {
	const registration = registrations.get(host) ?? register(host);
	const { spinning } = registration;
	spinning.set(out, (spinning.get(out) ?? 0) + 1);
	return () => {
		const left = (spinning.get(out) ?? 1) - 1;
		if (left > 0) {
			spinning.set(out, left);
			return false;
		}
		spinning.delete(out);
		if (spinning.size === 0) {
			unregister(host, registration);
		}
		return true;
	};
}

function register(host: TaskHost): Registration {
	const spinning = new Map<TaskOutput, number>();
	const registration: Registration = {
		spinning,
		stopWatching: restoreOnExit(host, () => {
			for (const out of spinning.keys()) {
				out.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
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
