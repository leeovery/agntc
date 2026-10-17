import { CLEAR_LINE, HIDE_CURSOR, SHOW_CURSOR } from "./control.js";
import { truncate } from "./layout.js";

const FRAMES = "⠁⠂⠄⡀⢀⠠⠐⠈";
const FRAME_MS = 80;

export interface TaskOutput {
	write(text: string): unknown;
}

export interface Task {
	/** Replaces the spinning line with `lines` and shows the cursor. */
	settle(lines: readonly string[]): void;
	/** Erases the spinning line and shows the cursor. */
	clear(): void;
}

/**
 * Spins `render(frame)` on one line until the task settles or clears, the
 * cursor hidden meanwhile. Each frame is cut to `width - 1` columns, as
 * `\r\x1b[2K` erases one row only. A render that throws ends the task first,
 * so nothing is left spinning or hidden. What a signal does to it is the
 * run's to say.
 */
export function startTask(
	out: TaskOutput,
	render: (frame: string) => string,
	width: number,
): Task {
	let frame = 0;
	const line = () => {
		const [first = ""] = render(FRAMES.charAt(frame % FRAMES.length)).split(
			"\n",
		);
		return `${CLEAR_LINE}${truncate(first, width - 1)}`;
	};
	out.write(`${HIDE_CURSOR}${line()}`);

	let finished = false;
	const finish = (text: string) => {
		if (finished) {
			return;
		}
		finished = true;
		clearInterval(timer);
		out.write(`${CLEAR_LINE}${text}${SHOW_CURSOR}`);
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
