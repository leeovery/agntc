const MIN_ROWS = 5;
const DEFAULT_ROWS = 24;

/**
 * How many lines of options a list shows at once: the prompt's own number,
 * else what the terminal's rows leave once `reserved` lines are kept for the
 * rest of the frame and what's above it, never under 5.
 */
export function windowSize(
	maxItems: number | undefined,
	rows: number | undefined,
	reserved: number,
): number {
	return Math.max(
		1,
		maxItems ?? Math.max(MIN_ROWS, (rows || DEFAULT_ROWS) - reserved),
	);
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
	return Math.max(0, Math.min(next, headings.length - size));
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
