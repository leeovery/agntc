import type {
	Choice,
	SelectFooter,
	SelectOption,
	SelectPrompt,
} from "../../ui.js";
import {
	isNarrow,
	MARGIN,
	padStart,
	roomFrom,
	spread,
	truncate,
	visibleWidth,
} from "../layout.js";
import { type Painter, type Style, statusTone } from "../style.js";
import { cellLayout, cellsText, hasCells, type PlacedChoice } from "./cells.js";
import {
	headingLine,
	labelColumn,
	linesAbove,
	listHints,
	optionLine,
	optionText,
	questionLines,
	TEXT_AT,
	windowLines,
} from "./lines.js";
import { ListEngine } from "./list-engine.js";
import { aboveRoom, fitList, type ListWindow } from "./list-window.js";
import {
	type PromptContext,
	type PromptStreams,
	runPrompt,
} from "./session.js";

export interface SelectQuestion<T> extends SelectPrompt<T> {
	/** The key hints on the question's line, in place of the usual ones. */
	hints?: string;
	/**
	 * Lines over the question, as the row it asks about, erased with it: at
	 * most `room` of them, the room the frame leaves once it has its own.
	 */
	above?: (room: number) => readonly string[];
}

/** What of a select's frame a screen shows: its window, its footer's lines, and the lines over its question. */
export interface SelectFit extends ListWindow {
	above: readonly string[];
	/** How many of the footer's two lines, the blank one and its own, show. */
	footerLines: number;
}

/** A select as it stands: the cursor's option, and the window of lines in view from `top`. */
export interface SelectView<T> extends ListWindow {
	/** Lines over the question; none unless given. */
	above?: readonly string[];
	message: string;
	hints: string;
	options: readonly SelectOption<T>[];
	cursor: number;
	top: number;
	footer?: SelectFooter;
	/** How many of the footer's two lines show, its last ones; both unless given. */
	footerLines?: number;
}

const CHOOSE = ["⏎ choose"];
export const SELECT_HINTS = listHints(CHOOSE);
/** How much further in than its heading a choice sits. */
const UNDER_HEADING = 2;
const KEY_GAP = "   ";
const COUNT_SEPARATOR = " · ";

/** Asks for one of the choices: its value, or null when cancelled. */
export async function promptSelect<T>(
	question: SelectQuestion<T>,
	context: PromptContext,
): Promise<T | null> {
	const { width, style } = context;
	const hints = hintsOf(question);
	const window = selectWindow(question, context.output.rows, width, style);
	const engine = await runPrompt(
		context,
		(streams) => new SelectEngine(question.options, window.size, streams),
		(engine, band) =>
			renderSelect(
				{
					...window,
					message: question.message,
					hints,
					options: question.options,
					cursor: engine.cursor,
					top: engine.top,
					...(question.footer === undefined ? {} : { footer: question.footer }),
				},
				width,
				style,
				band,
			),
	);
	return engine.answer;
}

/** The question line's key hints: none when a footer carries them. */
function hintsOf<T>(question: SelectQuestion<T>): string {
	if (question.hints !== undefined) {
		return question.hints;
	}
	if (question.footer !== undefined) {
		return "";
	}
	return listHints(CHOOSE, question.escape);
}

/**
 * The lines of options a select shows at once on a screen of `rows`, whether
 * its more lines show, how much of its footer does, and the lines over its
 * question in the room its question, its options' share and its footer leave.
 */
export function selectWindow<T>(
	question: SelectQuestion<T>,
	rows: number | undefined,
	width: number,
	style: Style,
): SelectFit {
	const asked = questionLines(
		question.message,
		hintsOf(question),
		width,
		style,
	).length;
	const frame = {
		lines: question.options.length,
		maxItems: question.maxItems,
		asked,
		footer: footerLines(question.footer, width, style).length,
	};
	const above = linesAbove(question.above, aboveRoom(frame, rows));
	const { size, more, footer } = fitList(
		{ ...frame, asked: above.length + asked },
		rows,
	);
	return { size, more, above, footerLines: footer };
}

export function renderSelect<T>(
	view: SelectView<T>,
	width: number,
	style: Style,
	band?: Painter,
): string[] {
	const room = roomFrom(TEXT_AT, width);
	const text = choiceText(view.options, width, style);
	const footer = footerLines(view.footer, width, style);
	return [
		...(view.above ?? []),
		...questionLines(view.message, view.hints, width, style),
		...windowLines(
			view.options,
			view.top,
			view,
			isChoice,
			(option, index) => {
				if (!isChoice(option)) {
					return headingLine(option.heading, width, style);
				}
				const current = index === view.cursor;
				return optionLine(
					text(option, index, room, current),
					current,
					width,
					style,
					band,
				);
			},
			width,
			style,
		),
		...footer.slice(footer.length - (view.footerLines ?? footer.length)),
	];
}

/** The blank line under the options and the footer's own; none when it has nothing to say at this width. */
function footerLines(
	footer: SelectFooter | undefined,
	width: number,
	style: Style,
): string[] {
	const line = footer === undefined ? "" : footerLine(footer, width, style);
	return line === "" ? [] : ["", line];
}

type ChoiceText<T> = (
	choice: Choice<T>,
	index: number,
	room: number,
	current: boolean,
) => string;

/**
 * How each choice's line reads: its cells lined up in columns laid out once
 * from every choice when they carry cells, else its label and its hint in the
 * hint column.
 */
function choiceText<T>(
	options: readonly SelectOption<T>[],
	width: number,
	style: Style,
): ChoiceText<T> {
	const insets = insetsOf(options);
	const placed = options.flatMap((option, index): PlacedChoice<T>[] =>
		isChoice(option) ? [{ choice: option, inset: insets[index] ?? 0 }] : [],
	);
	const choices = placed.map(({ choice }) => choice);
	if (hasCells(choices)) {
		const layout = cellLayout(placed, roomFrom(TEXT_AT, width));
		return (choice, index, room, current) =>
			cellsText(
				{ choice, inset: insets[index] ?? 0 },
				layout,
				room,
				style,
				current,
			);
	}
	const column = labelColumn(
		placed.map(({ choice, inset }) => inset + visibleWidth(choice.label)),
		width,
	);
	return (choice, index, room, current) =>
		optionText(choice, column, room, style, current, insets[index]);
}

/**
 * `↑↓ move` and the footer's keys dim on the left, its counts on the right,
 * each in its status's colour. Below 60 columns the keys drop, as the key
 * hints do; where the two don't fit, the counts are cut first.
 */
export function footerLine(
	footer: SelectFooter,
	width: number,
	style: Style,
): string {
	const keys = isNarrow(width)
		? ""
		: `${MARGIN}${style.dim(
				truncate(
					["↑↓ move", ...footer.keys].join(KEY_GAP),
					roomFrom(MARGIN.length, width),
				),
			)}`;
	const counts = (footer.counts ?? [])
		.filter(({ count }) => count > 0)
		.map(({ count, label, status }) =>
			statusTone(status, style)(`${count} ${label}`),
		)
		.join(style.dim(COUNT_SEPARATOR));
	const room =
		width - 1 - (keys === "" ? MARGIN.length : visibleWidth(keys) + 2);
	const right = room < 2 ? "" : truncate(counts, room);
	if (visibleWidth(right) === 0) {
		return keys;
	}
	return keys === ""
		? padStart(right, width - 1)
		: (spread(keys, right, width) ?? keys);
}

export function isChoice<T>(option: SelectOption<T>): option is Choice<T> {
	return !("heading" in option);
}

/** Each option's inset: two columns for a choice under a heading, none otherwise. */
function insetsOf<T>(options: readonly SelectOption<T>[]): number[] {
	let headed = false;
	return options.map((option) => {
		headed ||= !isChoice(option);
		return headed && isChoice(option) ? UNDER_HEADING : 0;
	});
}

class SelectEngine<T> extends ListEngine {
	constructor(
		private readonly options: readonly SelectOption<T>[],
		size: number,
		streams: PromptStreams,
	) {
		super(
			options.map((option) => !isChoice(option)),
			size,
			streams,
		);
	}

	get answer(): T | null {
		const option = this.options[this.cursor];
		return this.state === "submit" && option !== undefined && isChoice(option)
			? option.value
			: null;
	}
}
