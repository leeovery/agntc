import type { ConfirmPrompt } from "../../ui.js";
import { indent, visibleWidth } from "../layout.js";
import type { Style } from "../style.js";
import { Engine } from "./engine.js";
import {
	linesAbove,
	questionHead,
	questionLines,
	TEXT_AT,
	withHints,
} from "./lines.js";
import { frameRoom } from "./list-window.js";
import {
	noFrame,
	type PromptContext,
	type PromptStreams,
	runPrompt,
} from "./session.js";

export interface ConfirmQuestion extends ConfirmPrompt {
	/** Key hints on the question's line; it has none unless given. */
	hints?: string;
	/**
	 * Lines over the question, as the row it asks about, erased with it: at
	 * most `room` of them, the room the frame leaves once it has its own.
	 */
	above?: (room: number) => readonly string[];
}

export interface ConfirmView {
	/** Lines over the question; none unless given. */
	above?: readonly string[];
	message: string;
	hints: string;
	/** The button chosen: yes or no. */
	value: boolean;
}

const BUTTONS_GAP = 3;

/** Asks yes or no: the answer, or false when cancelled. */
export async function promptConfirm(
	question: ConfirmQuestion,
	context: PromptContext,
): Promise<boolean> {
	const { width, style } = context;
	const above = confirmAbove(question, context.output.rows, width, style);
	const engine = await runPrompt(
		context,
		(streams) => new ConfirmEngine(question.initialValue ?? true, streams),
		(engine) =>
			renderConfirm(
				{
					above,
					message: question.message,
					hints: question.hints ?? "",
					value: engine.chosen,
				},
				width,
				style,
			),
	);
	return engine.answer;
}

/**
 * The lines over a confirm's question on a screen of `rows`, in the room the
 * question and its buttons leave, whichever is chosen: No chosen is a
 * column wider than Yes chosen, so it can take a line more.
 */
export function confirmAbove(
	question: ConfirmQuestion,
	rows: number | undefined,
	width: number,
	style: Style,
): string[] {
	const asked = (value: boolean) =>
		askedLines(
			{ message: question.message, hints: question.hints ?? "", value },
			width,
			style,
		).length;
	return linesAbove(
		question.above,
		frameRoom(rows) - Math.max(asked(true), asked(false)),
	);
}

/**
 * The lines over the question, then ` ? <question>   ` and the two buttons;
 * the buttons on a line of their own when the question wraps.
 */
export function renderConfirm(
	view: ConfirmView,
	width: number,
	style: Style,
): string[] {
	return [...(view.above ?? []), ...askedLines(view, width, style)];
}

function askedLines(view: ConfirmView, width: number, style: Style): string[] {
	const buttons = renderButtons(view.value, style);
	const line = `${questionHead(view.message, style)}${indent(BUTTONS_GAP)}${buttons}`;
	if (visibleWidth(line) <= width - 1) {
		return [withHints(line, view.hints, width, style)];
	}
	return [
		...questionLines(view.message, view.hints, width, style),
		indent(TEXT_AT) + buttons,
	];
}

/**
 * ` Yes ` and ` No `, the chosen one in the accent with dark text, the other
 * dim. Without colour the chosen one is bracketed instead, as meaning never
 * rests on colour alone. An unchosen No's last space is left off the line.
 */
function renderButtons(yes: boolean, style: Style): string {
	return `${button("Yes", yes, style)} ${button("No", !yes, style)}`.trimEnd();
}

function button(label: string, chosen: boolean, style: Style): string {
	if (!chosen) {
		return ` ${style.dim(label)} `;
	}
	return style.level === 0
		? `[${label}]`
		: style.onAccent(style.bold(` ${label} `));
}

/**
 * Core's prompt on yes or no: ← (and core's h) chooses Yes, → (and l) No,
 * tab the other one, and y or n answers at once. Core's own confirm closes
 * itself inside its y and n listener and is closed again after it, so this
 * one submits through the state alone and core closes it once.
 */
class ConfirmEngine extends Engine {
	constructor(initialValue: boolean, streams: PromptStreams) {
		super({ ...streams, render: noFrame }, false);
		this.value = initialValue;
		this.on("cursor", (action) => {
			if (action === "left" || action === "right") {
				this.value = action === "left";
			}
		});
		this.on("key", (key) => {
			if (key === "\t") {
				this.value = !this.value;
			}
		});
		this.on("confirm", (answer) => {
			this.value = answer === true;
			this.state = "submit";
		});
	}

	get chosen(): boolean {
		return this.value === true;
	}

	get answer(): boolean {
		return this.state === "submit" && this.chosen;
	}
}
