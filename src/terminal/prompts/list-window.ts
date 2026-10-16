const DEFAULT_ROWS = 24;
/** The `↑ N more` and `↓ N more` lines a scrolled window may add. */
const MORE_LINES = 2;

/** What of a list's frame its fit on the screen counts. */
export interface ListFrame {
	/** Its lines of options, headings included. */
	lines: number;
	/** The most it shows at once. */
	maxItems?: number;
	/** The question's lines, over the options. */
	asked: number;
	/** The footer's lines, under them. */
	footer?: number;
}

/** The lines of options a list shows at once, and whether its more lines show. */
export interface ListWindow {
	size: number;
	more: boolean;
}

/** A list's window, and how many of its footer's last lines show under it. */
export interface ListFit extends ListWindow {
	footer: number;
}

/**
 * How a list fits a screen of `rows`: its frame a line shorter than the
 * screen, as the prompt's closing newline scrolls a frame as tall as the
 * screen, and its first line out of reach of the erase. The window shows the
 * list's `maxItems` at most, and keeps room for the more lines only when the
 * options don't all fit; when one option and the more lines don't, the more
 * lines go, then the footer's lines from its first. Never under one line, so
 * the frame fits wherever the question and one option do.
 */
export function fitList(frame: ListFrame, rows: number | undefined): ListFit {
	const { lines, asked, footer = 0 } = frame;
	const most = Math.max(1, Math.min(frame.maxItems ?? lines, lines));
	const budget = (rows || DEFAULT_ROWS) - 1 - asked;
	for (let kept = footer; kept >= 0; kept--) {
		const room = budget - kept;
		if (most >= lines && most <= room) {
			return { size: most, more: false, footer: kept };
		}
		if (room > MORE_LINES) {
			return {
				size: Math.min(most, room - MORE_LINES),
				more: true,
				footer: kept,
			};
		}
		if (room > 0) {
			return { size: Math.min(most, room), more: false, footer: kept };
		}
	}
	return { size: 1, more: false, footer: 0 };
}

/** The first line the cursor can stop on, or -1 when every line is a heading. */
export function firstStop(headings: readonly boolean[]): number {
	return headings.indexOf(false);
}

/** The next line the cursor can stop on, one way or the other, round the ends; `from` when there's none. */
export function stepCursor(
	headings: readonly boolean[],
	from: number,
	by: 1 | -1,
): number {
	const count = headings.length;
	for (let step = 1; step <= count; step++) {
		const at = (((from + by * step) % count) + count) % count;
		if (headings[at] === false) {
			return at;
		}
	}
	return from;
}

/**
 * The first line of a `size`-line window that shows the cursor, moved from
 * `top` no more than it must; the heading of the cursor's group comes into
 * view with it while both fit.
 */
export function scrollWindow(
	headings: readonly boolean[],
	cursor: number,
	top: number,
	size: number,
): number {
	let next = Math.min(Math.max(top, cursor - size + 1), cursor);
	const heading = headingAbove(headings, cursor);
	if (heading !== undefined && heading < next && cursor - heading < size) {
		next = heading;
	}
	// Below 0 only when nothing can take the cursor (-1).
	return Math.max(0, next);
}

function headingAbove(
	headings: readonly boolean[],
	cursor: number,
): number | undefined {
	for (let at = cursor - 1; at >= 0; at--) {
		if (headings[at] === true) {
			return at;
		}
	}
	return undefined;
}
