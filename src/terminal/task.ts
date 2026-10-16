import { truncate } from "./layout.js";

const FRAMES = "⠁⠂⠄⡀⢀⠠⠐⠈";
const FRAME_MS = 80;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[2K";

export interface TaskOutput {
	write(text: string): unknown;
}

type HostEvent = "exit" | "SIGINT" | "SIGTERM";

/** The process a task restores the cursor on exit of; tests pass their own. */
export interface TaskHost {
	on(event: HostEvent, listener: () => void): unknown;
	off(event: HostEvent, listener: () => void): unknown;
	exit(code: number): void;
}

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

/** A host's handlers and the tasks spinning on each of its outputs. */
interface Registration {
	spinning: Map<TaskOutput, number>;
	handlers: Record<HostEvent, () => void>;
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
	const restore = () => {
		for (const out of spinning.keys()) {
			out.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
		}
	};
	const exitOn = (code: number) => () => {
		restore();
		host.exit(code);
	};
	const registration: Registration = {
		spinning,
		handlers: { exit: restore, SIGINT: exitOn(130), SIGTERM: exitOn(143) },
	};
	for (const [event, handler] of entries(registration.handlers)) {
		host.on(event, handler);
	}
	registrations.set(host, registration);
	return registration;
}

function unregister(host: TaskHost, registration: Registration): void {
	for (const [event, handler] of entries(registration.handlers)) {
		host.off(event, handler);
	}
	registrations.delete(host);
}

function entries(
	handlers: Record<HostEvent, () => void>,
): [HostEvent, () => void][] {
	return Object.entries(handlers) as [HostEvent, () => void][];
}
