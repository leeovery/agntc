import type { Choice, SelectOption, SelectPrompt } from "../../ui.js";
import { roomFrom, visibleWidth } from "../layout.js";
import type { Painter, Style } from "../style.js";
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

/** What of a select's frame a screen shows: its window, and the lines over its question. */
export interface SelectFit extends ListWindow {
	above: readonly string[];
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
}

export const SELECT_HINTS = listHints("⏎ choose");
/** How much further in than its heading a choice sits. */
const UNDER_HEADING = 2;

/** Asks for one of the choices: its value, or null when cancelled. */
export async function promptSelect<T>(
	question: SelectQuestion<T>,
	context: PromptContext,
): Promise<T | null> {
	const { width, style } = context;
	const hints = question.hints ?? SELECT_HINTS;
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
				},
				width,
				style,
				band,
			),
	);
	return engine.answer;
}

/**
 * The lines of options a select shows at once on a screen of `rows`, whether
 * its more lines show, and the lines over its question in the room its
 * question and its options' share leave.
 */
export function selectWindow<T>(
	question: SelectQuestion<T>,
	rows: number | undefined,
	width: number,
	style: Style,
): SelectFit {
	const asked = questionLines(
		question.message,
		question.hints ?? SELECT_HINTS,
		width,
		style,
	).length;
	const frame = {
		lines: question.options.length,
		maxItems: question.maxItems,
		asked,
	};
	const above = linesAbove(question.above, aboveRoom(frame, rows));
	const { size, more } = fitList(
		{ ...frame, asked: above.length + asked },
		rows,
	);
	return { size, more, above };
}

export function renderSelect<T>(
	view: SelectView<T>,
	width: number,
	style: Style,
	band?: Painter,
): string[] {
	const insets = insetsOf(view.options);
	const column = labelColumn(
		view.options.flatMap((option, index) =>
			isChoice(option)
				? [(insets[index] ?? 0) + visibleWidth(option.label)]
				: [],
		),
		width,
	);
	const room = roomFrom(TEXT_AT, width);
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
					optionText(option, column, room, style, current, insets[index]),
					current,
					width,
					style,
					band,
				);
			},
			width,
			style,
		),
	];
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
