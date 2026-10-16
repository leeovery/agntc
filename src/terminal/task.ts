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
	/** Replaces the spinning line with `lines` and shows the cursor. */
	settle(lines: readonly string[]): void;
	/** Erases the spinning line and shows the cursor. */
	clear(): void;
}

/**
 * Spins `render(frame)` on one line until the task settles or clears, the
 * cursor hidden meanwhile.
 */
export function startTask(
	out: TaskOutput,
	render: (frame: string) => string,
	options: TaskOptions = {},
): Task {
	let frame = 0;
	const draw = () =>
		out.write(`${CLEAR_LINE}${render(FRAMES.charAt(frame % FRAMES.length))}`);
	const release = track(options.host ?? process, out);
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
		out.write(`${CLEAR_LINE}${text}${SHOW_CURSOR}`);
	};
	return {
		settle: (lines) => finish(lines.map((line) => `${line}\n`).join("")),
		clear: () => finish(""),
	};
}

interface Registration {
	tasks: Set<{ out: TaskOutput }>;
	handlers: Record<HostEvent, () => void>;
}

const registrations = new Map<TaskHost, Registration>();

/**
 * Counts a task against its host, whose handlers show the cursor on every
 * active task's output: added with the first task, removed with the last.
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
			out.write(SHOW_CURSOR);
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
