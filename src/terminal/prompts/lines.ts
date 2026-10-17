import type { Choice } from "../../ui.js";
import {
	indent,
	isNarrow,
	MARGIN,
	pad,
	roomFrom,
	spread,
	truncate,
	truncateStart,
	visibleWidth,
	wrap,
} from "../layout.js";
import { identity, type Painter, type Style } from "../style.js";
import type { ListWindow } from "./list-window.js";

/** ` ? ` before a question; ` ▌ ` or three spaces before an option, a heading or a more line. */
export const TEXT_AT = 3;
const LABEL_GAP = 3;
const MIN_LABEL_GAP = 2;
const LABEL_SHARE = 0.45;
/**
 * The fewest columns a label, its inset with it, is cut to before what's
 * beside it gives way, so choices still read apart at the narrowest widths.
 */
export const LABEL_FLOOR = 10;

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

/** The columns between one key's hint and the next, on the question's line and in a footer alike. */
export const KEY_GAP = "   ";

/** A list's usual key hints: moving, its own keys, then what esc does, cancelling unless given. */
export function listHints(keys: readonly string[], esc = "cancel"): string {
	return ["↑↓ move", ...keys, `esc ${esc}`].join(KEY_GAP);
}

/**
 * Where hints start, counted from where the options do: the widest label
 * (with its inset) and 3, at most 45% of the width, so the hints keep room.
 */
export function labelColumn(
	labelWidths: readonly number[],
	width: number,
): number {
	return Math.min(
		Math.max(0, ...labelWidths) + LABEL_GAP,
		Math.floor(width * LABEL_SHARE),
	);
}

/**
 * An option's label, `inset` columns in, and its dim hint in the label
 * column, inside `room`. The hint keeps its column: a label too wide to end
 * two short of it is cut at its start with `…`, as a key or a name is told
 * apart by its tail. A hint is cut with `…` to fit, and left out when nothing
 * of it would show, or when beside it the label would be cut below
 * {@link LABEL_FLOOR}; the label then takes the room.
 */
export function optionText<T>(
	choice: Choice<T>,
	column: number,
	room: number,
	style: Style,
	current: boolean,
	inset = 0,
): string {
	const floor = Math.min(inset + visibleWidth(choice.label), LABEL_FLOOR);
	const hint =
		column - MIN_LABEL_GAP < floor
			? ""
			: fitHint(choice.hint ?? "", room - column);
	const labelRoom = (hint === "" ? room : column - MIN_LABEL_GAP) - inset;
	const label = labelText(choice, labelRoom, style, current);
	if (hint === "") {
		return label === "" ? "" : indent(inset) + label;
	}
	return `${pad(indent(inset) + label, column)}${style.dim(hint)}`;
}

/** How wide a choice's label reads, its aside with it. */
export function labelWidth<T>({ label, aside }: Choice<T>): number {
	return visibleWidth(label) + (aside ? 1 + visibleWidth(aside) : 0);
}

/**
 * A choice's label inside `room`, bold on the cursor's row, then its aside
 * dim where both fit; else the label alone, cut at its start.
 */
export function labelText<T>(
	choice: Choice<T>,
	room: number,
	style: Style,
	current: boolean,
): string {
	const label = truncateStart(choice.label, Math.max(0, room));
	if (label === "") {
		return "";
	}
	const lead = (current ? style.bold : identity)(label);
	return choice.aside && labelWidth(choice) <= room
		? `${lead} ${style.dim(choice.aside)}`
		: lead;
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
	const text = truncateStart(heading, roomFrom(TEXT_AT, width));
	return at(TEXT_AT, text === "" ? "" : style.bold(text));
}

/**
 * The lines of `options` from `top` that fit in the window, with a dim
 * `↑ N more` above and `↓ N more` below for the options out of view when the
 * window has room for them.
 */
export function windowLines<O>(
	options: readonly O[],
	top: number,
	window: ListWindow,
	isOption: (option: O) => boolean,
	line: (option: O, index: number) => string,
	width: number,
	style: Style,
): string[] {
	const end = top + window.size;
	const hidden = (out: readonly O[]) =>
		window.more ? out.filter(isOption).length : 0;
	const above = hidden(options.slice(0, top));
	const below = hidden(options.slice(end));
	const more = (arrow: "↑" | "↓", count: number) =>
		count > 0 ? [moreLine(arrow, count, width, style)] : [];
	return [
		...more("↑", above),
		...options
			.slice(top, end)
			.map((option, index) => line(option, top + index)),
		...more("↓", below),
	];
}

/**
 * What a question's `above` gives in `room` lines: nothing without room, and
 * never more than the room, so the frame stays a line short of the screen.
 */
export function linesAbove(
	above: ((room: number) => readonly string[]) | undefined,
	room: number,
): string[] {
	return above === undefined || room < 1 ? [] : above(room).slice(0, room);
}

function moreLine(
	arrow: "↑" | "↓",
	count: number,
	width: number,
	style: Style,
): string {
	const text = truncate(
		`${arrow} ${count} more`,
		Math.max(0, roomFrom(TEXT_AT, width)),
	);
	return at(TEXT_AT, text === "" ? "" : style.dim(text));
}

/** `text` from `column`; an empty line stays empty. */
function at(column: number, text: string): string {
	return text === "" ? "" : indent(column) + text;
}
