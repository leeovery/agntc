import {
	indent,
	MARGIN,
	padStart,
	roomFrom,
	spread,
	visibleWidth,
	wrap,
} from "./layout.js";
import { type Style, statusTone } from "./style.js";
import type { TallyItem } from "./types.js";

const SEPARATOR = "  ·  ";
const CANCEL_TEXT_AT = 3;

/** A dim rule across the layout, then the tally, the elapsed time on the right. */
export function renderClose(
	tally: readonly TallyItem[],
	elapsedMs: number | undefined,
	width: number,
	style: Style,
): string[] {
	const rule = `${MARGIN}${style.dim("─".repeat(roomFrom(MARGIN.length, width)))}`;
	const counts = tally
		.filter((item) => item.count > 0)
		.map((item) =>
			statusTone(item.status, style)(`${item.count} ${item.label}`),
		);
	const lines = packed(
		counts,
		style.dim(SEPARATOR),
		roomFrom(MARGIN.length, width),
	).map((line) => MARGIN + line);
	if (elapsedMs === undefined) {
		return ["", rule, ...lines];
	}
	const elapsed = style.dim(formatElapsed(elapsedMs));
	const last = lines.pop() ?? MARGIN;
	const closing = spread(last, elapsed, width);
	return [
		"",
		rule,
		...lines,
		...(closing === undefined
			? [last, padStart(elapsed, width - 1)]
			: [closing]),
	];
}

/** Items joined by `separator`, breaking between items to stay inside `room`. */
function packed(
	items: readonly string[],
	separator: string,
	room: number,
): string[] {
	const lines: string[] = [];
	for (const item of items) {
		const line = lines.at(-1);
		if (
			line !== undefined &&
			visibleWidth(line) + visibleWidth(separator) + visibleWidth(item) <= room
		) {
			lines[lines.length - 1] = line + separator + item;
		} else {
			lines.push(item);
		}
	}
	return lines;
}

const TENTHS_PER_MINUTE = 600;

/** `2.4s` under a minute (never below `0.1s`), `1m 12s` from there. */
export function formatElapsed(ms: number): string {
	const tenths = Math.max(1, Math.round(ms / 100));
	if (tenths < TENTHS_PER_MINUTE) {
		return `${(tenths / 10).toFixed(1)}s`;
	}
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** ` ○ Cancelled`, or the caller's words, dim. */
export function renderCancel(
	width: number,
	style: Style,
	message = "Cancelled",
): string[] {
	const [first = "", ...rest] = wrap(message, roomFrom(CANCEL_TEXT_AT, width));
	return [
		`${MARGIN}${style.dim(`○ ${first}`)}`,
		...rest.map((line) => indent(CANCEL_TEXT_AT) + style.dim(line)),
	];
}
