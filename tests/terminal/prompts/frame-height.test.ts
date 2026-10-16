import { describe, expect, it } from "vitest";
import { scrollWindow } from "../../../src/terminal/prompts/list-window.js";
import {
	MULTISELECT_HINTS,
	multiselectWindowSize,
	renderMultiselect,
} from "../../../src/terminal/prompts/multiselect.js";
import {
	isChoice,
	renderSelect,
	SELECT_HINTS,
	type SelectOption,
	selectWindowSize,
} from "../../../src/terminal/prompts/select.js";
import { createStyle } from "../../../src/terminal/style.js";
import type { Choice } from "../../../src/ui.js";

// The erase rests on one rule: an open prompt's frame is never taller than
// the screen less a line, as the prompt's closing newline would scroll a
// taller frame's first line out of reach. It holds wherever the screen has
// room for one option beside the question, the more lines and the footer.

const style = createStyle(0);
const ROWS = Array.from({ length: 37 }, (_, index) => index + 4);
const WIDTHS = [40, 80];
const COUNTS = [1, 4, 30];
const QUESTIONS = [
	"Pick",
	"Select a skill or pack to manage, then choose what to do with it from the actions that follow",
	"x".repeat(150),
];
const MAX_ITEMS = [undefined, 3, 15, 100];

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

describe("an open prompt's frame", () => {
	it.each(
		WIDTHS,
	)("is a line shorter than the screen, a select at %i columns", (width) => {
		const over: string[] = [];
		for (const rows of ROWS) {
			for (const message of QUESTIONS) {
				const asked = renderSelect(
					{
						message,
						hints: SELECT_HINTS,
						options: [],
						cursor: -1,
						top: 0,
						size: 0,
					},
					width,
					style,
				).length;
				if (asked + 2 + 1 > rows - 1) {
					continue;
				}
				for (const count of COUNTS) {
					for (const headed of [false, true]) {
						for (const maxItems of MAX_ITEMS) {
							const options = selectOptions(count, headed);
							const question = { message, options, maxItems };
							const size = selectWindowSize(question, rows, width, style);
							const headings = options.map((option) => !isChoice(option));
							const stops = options.flatMap((option, index) =>
								isChoice(option) ? [index] : [],
							);
							for (const cursor of sampled(stops)) {
								const height = renderSelect(
									{
										message,
										hints: SELECT_HINTS,
										options,
										cursor,
										top: scrollWindow(headings, cursor, 0, size),
										size,
									},
									width,
									style,
								).length;
								if (height > rows - 1) {
									over.push(
										`${rows} rows, ${count} options${headed ? " under headings" : ""}, max ${maxItems}: ${height} lines`,
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
	)("is a line shorter than the screen, a multiselect at %i columns", (width) => {
		const over: string[] = [];
		for (const rows of ROWS) {
			for (const message of QUESTIONS) {
				const fixed = renderMultiselect(
					{
						message,
						hints: MULTISELECT_HINTS,
						options: [],
						cursor: -1,
						top: 0,
						size: 0,
						picked: [],
						warning: "pick at least one",
					},
					width,
					style,
				).length;
				if (fixed + 2 + 1 > rows - 1) {
					continue;
				}
				for (const count of COUNTS) {
					const options = choices(count);
					const size = multiselectWindowSize(
						{ message, options },
						rows,
						width,
						style,
					);
					const headings = options.map(() => false);
					for (const cursor of sampled(options.map((_, index) => index))) {
						const height = renderMultiselect(
							{
								message,
								hints: MULTISELECT_HINTS,
								options,
								cursor,
								top: scrollWindow(headings, cursor, 0, size),
								size,
								picked: [cursor],
								warning: "pick at least one",
							},
							width,
							style,
						).length;
						if (height > rows - 1) {
							over.push(`${rows} rows, ${count} options: ${height} lines`);
						}
					}
				}
			}
		}
		expect(over).toEqual([]);
	});
});
