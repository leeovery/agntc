import type { Choice, MultiselectPrompt } from "../../ui.js";
import {
	indent,
	padStart,
	roomFrom,
	spread,
	truncate,
	visibleWidth,
} from "../layout.js";
import type { Painter, Style } from "../style.js";
import {
	labelColumn,
	listHints,
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

export interface MultiselectQuestion<T> extends MultiselectPrompt<T> {
	/** The key hints on the question's line, in place of the usual ones. */
	hints?: string;
}

/** A multiselect as it stands: the cursor's option, the window in view, what's picked. */
export interface MultiselectView<T> {
	message: string;
	hints: string;
	options: readonly Choice<T>[];
	cursor: number;
	top: number;
	size: number;
	/** The picked options' indexes. */
	picked: readonly number[];
	/** Why enter didn't submit, until something is picked; empty otherwise. */
	warning: string;
}

export const MULTISELECT_HINTS = listHints("space pick", "a all", "⏎ done");
export const PICK_ONE = "pick at least one";
/** A mark and its space before each label. */
const LABEL_AT = TEXT_AT + 2;
/** The blank line under the options, and the footer. */
const FOOTER_LINES = 2;

/** Asks for any of the choices: their values in the options' order, or none when cancelled. */
export async function promptMultiselect<T>(
	question: MultiselectQuestion<T>,
	context: PromptContext,
): Promise<T[]> {
	const { width, style } = context;
	const hints = question.hints ?? MULTISELECT_HINTS;
	const size = multiselectWindowSize(
		question,
		context.output.rows,
		width,
		style,
	);
	const engine = await runPrompt(
		context,
		(streams) =>
			new MultiselectEngine(
				question.options,
				question.required === true,
				size,
				streams,
			),
		(engine, band) =>
			renderMultiselect(
				{
					message: question.message,
					hints,
					options: question.options,
					cursor: engine.cursor,
					top: engine.top,
					size,
					picked: engine.picked,
					warning: engine.error,
				},
				width,
				style,
				band,
			),
	);
	return engine.answer;
}

/** The lines of options a multiselect shows at once on a screen of `rows`. */
export function multiselectWindowSize<T>(
	question: MultiselectQuestion<T>,
	rows: number | undefined,
	width: number,
	style: Style,
): number {
	const asked = questionLines(
		question.message,
		question.hints ?? MULTISELECT_HINTS,
		width,
		style,
	);
	return windowSize(undefined, rows, asked.length + FOOTER_LINES);
}

export function renderMultiselect<T>(
	view: MultiselectView<T>,
	width: number,
	style: Style,
	band?: Painter,
): string[] {
	const column = labelColumn(
		view.options.map((option) => visibleWidth(option.label)),
		width,
	);
	const room = roomFrom(LABEL_AT, width);
	return [
		...questionLines(view.message, view.hints, width, style),
		...windowLines(
			view.options,
			view.top,
			view.size,
			() => true,
			(option, index) => {
				const current = index === view.cursor;
				const mark = view.picked.includes(index)
					? style.accent("●")
					: style.dim("○");
				const text = optionText(option, column, room, style, current);
				return optionLine(
					text === "" ? mark : `${mark} ${text}`,
					current,
					width,
					style,
					band,
				);
			},
			style,
		),
		"",
		footer(view, width, style),
	];
}

/** `N of M picked` dim at the right margin, after the warning when there is one. */
function footer<T>(
	view: MultiselectView<T>,
	width: number,
	style: Style,
): string {
	const count = style.dim(
		truncate(
			`${view.picked.length} of ${view.options.length} picked`,
			width - 1,
		),
	);
	if (view.warning === "") {
		return padStart(count, width - 1);
	}
	const warning = `${indent(TEXT_AT)}${style.attention(
		truncate(view.warning, roomFrom(TEXT_AT, width)),
	)}`;
	return spread(warning, count, width) ?? warning;
}

const requireOne = (picked: readonly number[]) =>
	picked.length === 0 ? PICK_ONE : undefined;

/**
 * Core's prompt over the options. What's picked is mirrored into core's
 * value, which its validation reads on enter, so `required` holds enter back
 * while nothing is picked; the error that sets stands until something is.
 */
class MultiselectEngine<T> extends ListEngine {
	private chosen: readonly number[] = [];

	constructor(
		private readonly options: readonly Choice<T>[],
		required: boolean,
		size: number,
		streams: PromptStreams,
	) {
		super(
			options.map(() => false),
			size,
			{ ...streams, validate: required ? requireOne : undefined },
		);
		this.value = this.chosen;
		this.on("cursor", (action) => {
			if (action === "space") {
				this.toggle(this.cursor);
			}
		});
		this.on("key", (key) => {
			if (key === "a") {
				this.toggleAll();
			}
		});
	}

	/** The picked options' indexes. */
	get picked(): readonly number[] {
		return this.chosen;
	}

	get answer(): T[] {
		return this.state === "submit"
			? this.options
					.filter((_, index) => this.chosen.includes(index))
					.map(({ value }) => value)
			: [];
	}

	private toggle(index: number): void {
		if (this.options[index] === undefined) {
			return;
		}
		this.pick(
			this.chosen.includes(index)
				? this.chosen.filter((picked) => picked !== index)
				: [...this.chosen, index],
		);
	}

	private toggleAll(): void {
		this.pick(
			this.chosen.length === this.options.length
				? []
				: this.options.map((_, index) => index),
		);
	}

	private pick(picked: readonly number[]): void {
		this.chosen = picked;
		this.value = picked;
		if (picked.length > 0) {
			this.error = "";
		}
	}
}
