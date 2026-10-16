import type { Choice, SelectPrompt } from "../../ui.js";
import { roomFrom } from "../layout.js";
import type { Painter, Style } from "../style.js";
import {
	headingLine,
	labelColumn,
	optionLine,
	optionText,
	questionLines,
	TEXT_AT,
	windowLines,
} from "./lines.js";
import { ListEngine } from "./list-engine.js";
import { windowSize } from "./list-window.js";
import {
	type PromptContext,
	type PromptStreams,
	runPrompt,
} from "./session.js";

/** A choice, or a bold heading over the choices after it that the cursor passes over. */
export type SelectOption<T> = Choice<T> | { heading: string };

export interface SelectQuestion<T> extends Omit<SelectPrompt<T>, "options"> {
	options: readonly SelectOption<T>[];
	/** The key hints on the question's line, in place of the usual ones. */
	hints?: string;
}

/** A select as it stands: the cursor's option, and the window of lines in view. */
export interface SelectView<T> {
	message: string;
	hints: string;
	options: readonly SelectOption<T>[];
	cursor: number;
	top: number;
	size: number;
}

export const SELECT_HINTS = "↑↓ move · ⏎ choose · esc cancel";
/** The question, both more lines and three lines above the prompt. */
const RESERVED_ROWS = 6;

/** Asks for one of the choices: its value, or null when cancelled. */
export async function promptSelect<T>(
	question: SelectQuestion<T>,
	context: PromptContext,
): Promise<T | null> {
	const size = windowSize(
		question.maxItems,
		context.output.rows,
		RESERVED_ROWS,
	);
	const engine = await runPrompt(
		context,
		(streams) => new SelectEngine(question.options, size, streams),
		(engine, band) =>
			renderSelect(
				{
					message: question.message,
					hints: question.hints ?? SELECT_HINTS,
					options: question.options,
					cursor: engine.cursor,
					top: engine.top,
					size,
				},
				context.width,
				context.style,
				band,
			),
	);
	return engine.answer;
}

export function renderSelect<T>(
	view: SelectView<T>,
	width: number,
	style: Style,
	band?: Painter,
): string[] {
	const column = labelColumn(
		view.options.filter(isChoice).map((choice) => choice.label),
		width,
	);
	const room = roomFrom(TEXT_AT, width);
	return [
		...questionLines(view.message, view.hints, width, style),
		...windowLines(
			view.options,
			view.top,
			view.size,
			isChoice,
			(option, index) => {
				if (!isChoice(option)) {
					return headingLine(option.heading, width, style);
				}
				const current = index === view.cursor;
				return optionLine(
					optionText(option, column, room, style, current),
					current,
					width,
					style,
					band,
				);
			},
			style,
		),
	];
}

export function isChoice<T>(option: SelectOption<T>): option is Choice<T> {
	return !("heading" in option);
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
