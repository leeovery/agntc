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

/** Tasks spinning on each output, so the cursor comes back only with the last. */
const spinning = new Map<TaskOutput, number>();

/**
 * Spins `render(frame)` on one line until the task settles or clears, the
 * cursor hidden meanwhile. Each frame is cut to `width - 1` columns, as
 * `\r\x1b[2K` erases one row only.
 */
export function startTask(
	out: TaskOutput,
	render: (frame: string) => string,
	width: number,
	options: TaskOptions = {},
): Task {
	let frame = 0;
	const draw = () => {
		const [line = ""] = render(FRAMES.charAt(frame % FRAMES.length)).split(
			"\n",
		);
		out.write(`${CLEAR_LINE}${truncate(line, width - 1)}`);
	};
	const release = track(options.host ?? process, out);
	spinning.set(out, (spinning.get(out) ?? 0) + 1);
	out.write(HIDE_CURSOR);
	draw();
	const timer = setInterval(() => {
		frame += 1;
		draw();
	}, FRAME_MS);

	let finished = false;
	const finish = (text: string) => {
		if (finished) {
			return;
		}
		finished = true;
		clearInterval(timer);
		release();
		out.write(`${CLEAR_LINE}${text}${stopSpinning(out) ? SHOW_CURSOR : ""}`);
	};
	return {
		settle: (lines) => finish(lines.map((line) => `${line}\n`).join("")),
		clear: () => finish(""),
	};
}

/** Counts a task off its output; true when it was the last there. */
function stopSpinning(out: TaskOutput): boolean {
	const left = (spinning.get(out) ?? 1) - 1;
	if (left === 0) {
		spinning.delete(out);
	} else {
		spinning.set(out, left);
	}
	return left === 0;
}

interface Registration {
	tasks: Set<{ out: TaskOutput }>;
	handlers: Record<HostEvent, () => void>;
}

const registrations = new Map<TaskHost, Registration>();

/**
 * Counts a task against its host, whose handlers erase the spinning line and
 * show the cursor on every active task's output: added with the first task,
 * removed with the last.
 */
function track(host: TaskHost, out: TaskOutput): () => void {
	const registration = registrations.get(host) ?? register(host);
	const task = { out };
	registration.tasks.add(task);
	return () => {
		registration.tasks.delete(task);
		if (registration.tasks.size === 0) {
			unregister(host, registration);
		}
	};
}

function register(host: TaskHost): Registration {
	const tasks = new Set<{ out: TaskOutput }>();
	const restore = () => {
		for (const out of new Set([...tasks].map((task) => task.out))) {
			out.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
		}
	};
	const exitOn = (code: number) => () => {
		restore();
		host.exit(code);
	};
	const registration: Registration = {
		tasks,
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
