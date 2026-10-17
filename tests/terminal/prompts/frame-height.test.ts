import { describe, expect, it } from "vitest";
import { blockLayout, renderRowWithin } from "../../../src/terminal/block.js";
import {
	confirmAbove,
	renderConfirm,
} from "../../../src/terminal/prompts/confirm.js";
import { questionLines } from "../../../src/terminal/prompts/lines.js";
import { scrollWindow } from "../../../src/terminal/prompts/list-window.js";
import {
	MULTISELECT_HINTS,
	multiselectFit,
	renderMultiselect,
} from "../../../src/terminal/prompts/multiselect.js";
import {
	isChoice,
	renderSelect,
	SELECT_HINTS,
	selectWindow,
} from "../../../src/terminal/prompts/select.js";
import { createStyle } from "../../../src/terminal/style.js";
import type { Row } from "../../../src/terminal/types.js";
import type { Choice, SelectOption } from "../../../src/ui.js";

// The erase rests on one rule: an open prompt's frame is never taller than
// the screen less a line, as the prompt's closing newline would scroll a
// taller frame's first line out of reach. It holds wherever the screen has
// room for the question and one option, however many lines a row over the
// question would take, and that row never takes the options' share: as many
// as half the frame's room, or all of them when they take less.

const style = createStyle(0);
const ROWS = Array.from({ length: 38 }, (_, index) => index + 3);
const WIDTHS = [40, 80];
const COUNTS = [1, 2, 4, 30];
const QUESTIONS = [
	"Pick",
	"Select a skill or pack to manage, then choose what to do with it from the actions that follow",
	"x".repeat(150),
];
const MAX_ITEMS = [undefined, 3, 15, 100];
/** How many children the row over the question has; -1 for an above that ignores its room. */
const ABOVES = [0, 3, 50, -1];

/**
 * A row over the question, fitted to its room as a block fits it, its
 * children's details wrapping every other one; or, at -1, lines that ignore
 * the room, which the prompt still holds to it.
 */
function aboveOf(children: number, width: number): (room: number) => string[] {
	if (children < 0) {
		return (room) => Array.from({ length: room + 5 }, () => " · greedy");
	}
	const row: Row = {
		status: "done",
		subject: "owner/repo",
		meta: "HEAD",
		detail: "2 skills",
		children: Array.from({ length: children }, (_, index) => ({
			name: `child-${index}`,
			status: "note",
			detail:
				index % 2 === 0
					? "short"
					: "already installed as part of the pack /Users/someone/code/skills/a-long-pack",
		})),
	};
	const layout = blockLayout([row], width);
	const fitted = new Map<number, string[]>();
	return (room) => {
		if (!fitted.has(room)) {
			const lines = renderRowWithin(row, room - 1, layout, width, style);
			fitted.set(room, lines.length === 0 ? [] : [...lines, ""]);
		}
		return fitted.get(room) ?? [];
	};
}

const ABOVE_BY_WIDTH = new Map(
	WIDTHS.map((width) => [
		width,
		new Map(ABOVES.map((children) => [children, aboveOf(children, width)])),
	]),
);

/** The row over the question with `children`, at `width`, fitted once per room. */
function aboveFor(children: number, width: number): (room: number) => string[] {
	return ABOVE_BY_WIDTH.get(width)?.get(children) ?? (() => []);
}

/** The options a frame keeps under a row over its question. */
function share(lines: number, rows: number, maxItems?: number): number {
	return Math.min(maxItems ?? lines, lines, Math.floor((rows - 1) / 2));
}

const choices = (count: number): Choice<number>[] =>
	Array.from({ length: count }, (_, index) => ({
		value: index,
		label: `skill-${index}`,
		hint: "a description of what the skill does",
	}));

/** The choices, a heading before every fourth when `headed`. */
function selectOptions(count: number, headed: boolean): SelectOption<number>[] {
	return choices(count).flatMap((choice, index) =>
		headed && index % 4 === 0
			? [{ heading: `owner/repo-${index}` }, choice]
			: [choice],
	);
}

/** A few cursor positions from each end and the middle. */
function sampled(stops: readonly number[]): number[] {
	const last = stops.length - 1;
	return [...new Set([0, 1, Math.floor(last / 2), last - 1, last])].flatMap(
		(at) => (at >= 0 && at <= last ? [stops[at] ?? 0] : []),
	);
}

/** The screens a question and one option fit on. */
function roomy(message: string, hints: string, width: number): number[] {
	const asked = questionLines(message, hints, width, style).length;
	return ROWS.filter((rows) => asked + 1 <= rows - 1);
}

describe("an open prompt's frame", () => {
	it.each(
		WIDTHS,
	)("is a line shorter than the screen, a select at %i columns", (width) => {
		const over: string[] = [];
		for (const message of QUESTIONS) {
			for (const rows of roomy(message, SELECT_HINTS, width)) {
				for (const count of COUNTS) {
					for (const headed of [false, true]) {
						for (const [maxItems, lines] of MAX_ITEMS.flatMap((most) =>
							ABOVES.map((above) => [most, above] as const),
						)) {
							const options = selectOptions(count, headed);
							const above = aboveFor(lines, width);
							const question = { message, options, maxItems, above };
							const window = selectWindow(question, rows, width, style);
							if (
								window.above.length > 0 &&
								window.size < share(options.length, rows, maxItems)
							) {
								over.push(
									`${rows} rows, ${count} options, max ${maxItems}, ${lines} above: ${window.size} options shown`,
								);
							}
							const headings = options.map((option) => !isChoice(option));
							const stops = options.flatMap((option, index) =>
								isChoice(option) ? [index] : [],
							);
							for (const cursor of sampled(stops)) {
								const height = renderSelect(
									{
										...window,
										message,
										hints: SELECT_HINTS,
										options,
										cursor,
										top: scrollWindow(headings, cursor, 0, window.size),
									},
									width,
									style,
								).length;
								if (height > rows - 1) {
									over.push(
										`${rows} rows, ${count} options${headed ? " under headings" : ""}, max ${maxItems}, ${lines} above: ${height} lines`,
									);
								}
							}
						}
					}
				}
			}
		}
		expect(over).toEqual([]);
	});

	it.each(
		WIDTHS,
	)("is a line shorter than the screen, a select with a footer and cells at %i columns", (width) => {
		const footer = {
			keys: ["⏎ manage", "esc done"],
			counts: [{ count: 3, label: "updates", status: "newer" as const }],
		};
		const over: string[] = [];
		for (const message of QUESTIONS) {
			for (const rows of roomy(message, "", width)) {
				for (const [count, lines] of COUNTS.flatMap((count) =>
					ABOVES.map((above) => [count, above] as const),
				)) {
					const options = selectOptions(count, true).map((option) =>
						isChoice(option)
							? {
									...option,
									cells: [
										{ text: "pack", dim: true },
										{ text: "v1.0.0", aside: "^1.0.0" },
										{ status: "newer" as const, text: "v1.1.0" },
									],
								}
							: option,
					);
					const above = aboveFor(lines, width);
					const question = { message, options, above, footer };
					const window = selectWindow(question, rows, width, style);
					if (
						window.above.length > 0 &&
						window.size < share(options.length, rows)
					) {
						over.push(
							`${rows} rows, ${count} options, ${lines} above: ${window.size} options shown`,
						);
					}
					const headings = options.map((option) => !isChoice(option));
					const stops = options.flatMap((option, index) =>
						isChoice(option) ? [index] : [],
					);
					for (const cursor of sampled(stops)) {
						const height = renderSelect(
							{
								...window,
								message,
								hints: "",
								options,
								cursor,
								top: scrollWindow(headings, cursor, 0, window.size),
								footer,
							},
							width,
							style,
						).length;
						if (height > rows - 1) {
							over.push(
								`${rows} rows, ${count} options, ${lines} above: ${height} lines`,
							);
						}
					}
				}
			}
		}
		expect(over).toEqual([]);
	});

	it.each(
		WIDTHS,
	)("is a line shorter than the screen, a multiselect at %i columns", (width) => {
		const over: string[] = [];
		for (const message of QUESTIONS) {
			for (const rows of roomy(message, MULTISELECT_HINTS, width)) {
				for (const [count, lines] of COUNTS.flatMap((count) =>
					ABOVES.map((above) => [count, above] as const),
				)) {
					const options = choices(count);
					const above = aboveFor(lines, width);
					const fit = multiselectFit(
						{ message, options, above },
						rows,
						width,
						style,
					);
					if (fit.above.length > 0 && fit.size < share(count, rows)) {
						over.push(
							`${rows} rows, ${count} options, ${lines} above: ${fit.size} options shown`,
						);
					}
					const headings = options.map(() => false);
					for (const cursor of sampled(options.map((_, index) => index))) {
						const height = renderMultiselect(
							{
								...fit,
								message,
								hints: MULTISELECT_HINTS,
								options,
								cursor,
								top: scrollWindow(headings, cursor, 0, fit.size),
								picked: [cursor],
								warning: "pick at least one",
							},
							width,
							style,
						).length;
						if (height > rows - 1) {
							over.push(
								`${rows} rows, ${count} options, ${lines} above: ${height} lines`,
							);
						}
					}
				}
			}
		}
		expect(over).toEqual([]);
	});

	it.each(
		WIDTHS,
	)("is a line shorter than the screen, a confirm at %i columns", (width) => {
		const over: string[] = [];
		for (const message of QUESTIONS) {
			const asked = (value: boolean) =>
				renderConfirm({ message, hints: "", value }, width, style).length;
			const least = Math.max(asked(true), asked(false));
			for (const rows of ROWS.filter((rows) => least <= rows - 1)) {
				for (const lines of ABOVES) {
					const question = { message, above: aboveFor(lines, width) };
					const above = confirmAbove(question, rows, width, style);
					for (const value of [true, false]) {
						const height = renderConfirm(
							{ above, message, hints: "", value },
							width,
							style,
						).length;
						if (height > rows - 1) {
							over.push(`${rows} rows, ${lines} above: ${height} lines`);
						}
					}
				}
			}
		}
		expect(over).toEqual([]);
	});

	it("leaves a confirm's above no more than both its buttons' widths allow", () => {
		// "[Yes]  No" is a column narrower than " Yes  [No]": at 24 columns Yes
		// chosen keeps the buttons beside the question, and No chosen wraps them.
		const message = "Proceed?";
		const widths = [true, false].map(
			(value) => renderConfirm({ message, hints: "", value }, 24, style).length,
		);
		expect(widths).toEqual([1, 2]);
		const above = confirmAbove(
			{ message, above: (room) => Array.from({ length: room }, () => " · x") },
			4,
			24,
			style,
		);
		expect(
			renderConfirm({ above, message, hints: "", value: false }, 24, style),
		).toHaveLength(3);
	});
});
