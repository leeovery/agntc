const DEFAULT_ROWS = 24;
/** The `↑ N more` and `↓ N more` lines a scrolled window may add. */
const MORE_LINES = 2;

/**
 * How many lines of options a list shows at once: the prompt's own number at
 * most, and no more than keep its frame a line shorter than the screen, with
 * the more lines and the frame's `fixed` ones (its question and footer)
 * counted. The erase needs that line: the prompt's closing newline scrolls a
 * frame as tall as the screen, and its first line out of reach. Never under one.
 */
export function windowSize(
	maxItems: number | undefined,
	rows: number | undefined,
	fixed: number,
): number {
	const room = (rows || DEFAULT_ROWS) - 1 - fixed - MORE_LINES;
	return Math.max(1, Math.min(maxItems ?? room, room));
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
