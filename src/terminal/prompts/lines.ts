import type { Choice } from "../../ui.js";
import {
	indent,
	isNarrow,
	MARGIN,
	pad,
	roomFrom,
	spread,
	truncate,
	visibleWidth,
	wrap,
} from "../layout.js";
import { identity, type Painter, type Style } from "../style.js";

/** ` ? ` before a question; ` ▌ ` or three spaces before an option, a heading or a more line. */
export const TEXT_AT = 3;
const LABEL_GAP = 3;
const MIN_LABEL_GAP = 2;
const LABEL_SHARE = 0.45;

/** ` ? <question>`, wrapped, with dim key hints on the right of a line it fits on. */
export function questionLines(
	message: string,
	hints: string,
	width: number,
	style: Style,
): string[] {
	const [first = "", ...rest] = wrap(message, roomFrom(TEXT_AT, width));
	return [
		withHints(
			questionHead(first, style),
			rest.length === 0 ? hints : "",
			width,
			style,
		),
		...rest.map((line) => at(TEXT_AT, line === "" ? "" : style.bold(line))),
	];
}

/** ` ? <question>`, the `?` in the accent and the question bold. */
export function questionHead(question: string, style: Style): string {
	const mark = `${MARGIN}${style.accent("?")}`;
	return question === "" ? mark : `${mark} ${style.bold(question)}`;
}

/** `line` with the hints dim at the right margin; without them below 60 columns or when they don't fit. */
export function withHints(
	line: string,
	hints: string,
	width: number,
	style: Style,
): string {
	if (hints === "" || isNarrow(width)) {
		return line;
	}
	return spread(line, style.dim(hints), width) ?? line;
}

/**
 * Where hints start, counted from the labels: the widest label and 3, at
 * most 45% of the width, so the hints keep room.
 */
export function labelColumn(labels: readonly string[], width: number): number {
	const widest = Math.max(0, ...labels.map(visibleWidth));
	return Math.min(widest + LABEL_GAP, Math.floor(width * LABEL_SHARE));
}

/**
 * An option's label and its dim hint in the label column, inside `room`. A
 * label too wide for its column puts its hint two spaces after it; a hint
 * is cut with `…` to fit, and left out when nothing of it would show.
 */
export function optionText<T>(
	choice: Choice<T>,
	column: number,
	room: number,
	style: Style,
	current: boolean,
): string {
	const label = truncate(choice.label, Math.max(0, room));
	const used = visibleWidth(label);
	const hintAt = Math.max(column, used + MIN_LABEL_GAP);
	const hint = fitHint(choice.hint ?? "", room - hintAt);
	const painted = label === "" ? "" : (current ? style.bold : identity)(label);
	return hint === ""
		? painted
		: `${painted}${indent(hintAt - used)}${style.dim(hint)}`;
}

function fitHint(hint: string, room: number): string {
	if (hint === "" || room < 1) {
		return "";
	}
	const cut = truncate(hint, room);
	return cut === "…" ? "" : cut;
}

/**
 * An option's line: three spaces before it, or on the cursor row an accent
 * `▌` and, when the band is known, the band from column 2 to the margin.
 */
export function optionLine(
	text: string,
	current: boolean,
	width: number,
	style: Style,
	band: Painter | undefined,
): string {
	if (!current) {
		return at(TEXT_AT, text);
	}
	const bar = `${MARGIN}${style.accent("▌")}`;
	if (band !== undefined) {
		return bar + band(` ${pad(text, roomFrom(TEXT_AT, width))}`);
	}
	return text === "" ? bar : `${bar} ${text}`;
}

export function headingLine(
	heading: string,
	width: number,
	style: Style,
): string {
	const text = truncate(heading, Math.max(0, roomFrom(TEXT_AT, width)));
	return at(TEXT_AT, text === "" ? "" : style.bold(text));
}

/**
 * The lines of `options` from `top` that fit in `size`, with a dim
 * `↑ N more` above and `↓ N more` below for the options out of view.
 */
export function windowLines<O>(
	options: readonly O[],
	top: number,
	size: number,
	isOption: (option: O) => boolean,
	line: (option: O, index: number) => string,
	style: Style,
): string[] {
	const end = top + size;
	const above = options.slice(0, top).filter(isOption).length;
	const below = options.slice(end).filter(isOption).length;
	return [
		...(above > 0 ? [moreLine("↑", above, style)] : []),
		...options
			.slice(top, end)
			.map((option, index) => line(option, top + index)),
		...(below > 0 ? [moreLine("↓", below, style)] : []),
	];
}

function moreLine(arrow: "↑" | "↓", count: number, style: Style): string {
	return at(TEXT_AT, style.dim(`${arrow} ${count} more`));
}

/** `text` from `column`; an empty line stays empty. */
function at(column: number, text: string): string {
	return text === "" ? "" : indent(column) + text;
}
