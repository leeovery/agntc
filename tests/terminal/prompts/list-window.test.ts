import { describe, expect, it } from "vitest";
import {
	aboveRoom,
	firstStop,
	fitList,
	scrollWindow,
	stepCursor,
} from "../../../src/terminal/prompts/list-window.js";

/** Ten options, none a heading. */
const flat = Array.from({ length: 10 }, () => false);
/** Two groups: a heading over two options, then a heading over five. */
const grouped = [true, false, false, true, false, false, false, false, false];

describe("fitList", () => {
	const scrolled = (size: number, footer = 0) => ({ size, more: true, footer });
	const whole = (size: number, footer = 0) => ({ size, more: false, footer });

	it("shows every option, with no room kept for more lines, when they all fit", () => {
		expect(fitList({ lines: 5, asked: 1 }, 30)).toEqual(whole(5));
		expect(fitList({ lines: 27, asked: 1, footer: 1 }, 30)).toEqual(
			whole(27, 1),
		);
	});

	it("keeps the frame a line shorter than the screen, its question, more lines and footer counted", () => {
		expect(fitList({ lines: 40, asked: 1 }, 30)).toEqual(scrolled(26));
		expect(fitList({ lines: 40, asked: 1, footer: 2 }, 30)).toEqual(
			scrolled(24, 2),
		);
		expect(fitList({ lines: 29, asked: 1 }, 30)).toEqual(scrolled(26));
	});

	it("takes the prompt's own most when the rows have room for it, scrolling past it", () => {
		expect(fitList({ lines: 10, maxItems: 3, asked: 1 }, 40)).toEqual(
			scrolled(3),
		);
		expect(fitList({ lines: 3, maxItems: 5, asked: 1 }, 40)).toEqual(whole(3));
	});

	it("never takes more than the rows leave, whatever the prompt asks", () => {
		expect(fitList({ lines: 30, maxItems: 15, asked: 1 }, 12)).toEqual(
			scrolled(8),
		);
	});

	it("reads 24 rows when the terminal gives none", () => {
		expect(fitList({ lines: 40, asked: 1 }, undefined)).toEqual(scrolled(20));
		expect(fitList({ lines: 40, asked: 1 }, 0)).toEqual(scrolled(20));
	});

	it("gives up the more lines when one option and they don't fit", () => {
		expect(fitList({ lines: 10, asked: 1 }, 4)).toEqual(whole(2));
		expect(fitList({ lines: 10, asked: 1, footer: 2 }, 6)).toEqual(whole(2, 2));
	});

	it("then the footer's lines, its first going first", () => {
		expect(fitList({ lines: 10, asked: 1, footer: 2 }, 4)).toEqual(whole(1, 1));
		expect(fitList({ lines: 10, asked: 1, footer: 2 }, 3)).toEqual(whole(1, 0));
		expect(fitList({ lines: 1, asked: 1, footer: 2 }, 4)).toEqual(whole(1, 1));
	});

	it("never shows fewer than one line", () => {
		expect(fitList({ lines: 10, asked: 3 }, 4)).toEqual(whole(1));
		expect(fitList({ lines: 10, maxItems: 0, asked: 1 }, 30)).toEqual(
			scrolled(1),
		);
	});
});

describe("aboveRoom", () => {
	it("leaves the row what the question, the footer and every option don't take, when they fit in half", () => {
		expect(aboveRoom({ lines: 5, asked: 1, footer: 2 }, 24)).toBe(15);
	});

	it("keeps half the frame for the options when they don't all fit, with their more lines", () => {
		// 23 lines of frame: 11 options and their two more lines, the question, the footer.
		expect(aboveRoom({ lines: 30, asked: 1, footer: 2 }, 24)).toBe(7);
	});

	it("keeps the options only the lines they take whole when that's fewer than their share with its more lines", () => {
		// 7 lines of frame: half is 3 options and two more lines, but all 4 take 4.
		expect(aboveRoom({ lines: 4, asked: 1 }, 8)).toBe(2);
		expect(aboveRoom({ lines: 5, asked: 1 }, 10)).toBe(3);
		// A list cut to its most still keeps its more lines.
		expect(aboveRoom({ lines: 4, maxItems: 3, asked: 1 }, 8)).toBe(1);
	});

	it("keeps no more than the list's own most", () => {
		expect(aboveRoom({ lines: 30, maxItems: 3, asked: 1 }, 24)).toBe(17);
	});

	it("leaves nothing on a screen too small for the question and the options' share", () => {
		expect(aboveRoom({ lines: 5, asked: 1, footer: 2 }, 6)).toBe(0);
		expect(aboveRoom({ lines: 1, asked: 1 }, 2)).toBe(0);
	});
});

describe("stepCursor", () => {
	it("moves one line either way", () => {
		expect(stepCursor(flat, 4, 1)).toBe(5);
		expect(stepCursor(flat, 4, -1)).toBe(3);
	});

	it("wraps round both ends", () => {
		expect(stepCursor(flat, 9, 1)).toBe(0);
		expect(stepCursor(flat, 0, -1)).toBe(9);
	});

	it("passes over headings, wrapping past the first", () => {
		expect(stepCursor(grouped, 2, 1)).toBe(4);
		expect(stepCursor(grouped, 4, -1)).toBe(2);
		expect(stepCursor(grouped, 8, 1)).toBe(1);
		expect(stepCursor(grouped, 1, -1)).toBe(8);
	});

	it("stays put with nowhere to stop", () => {
		expect(stepCursor([true, true], 0, 1)).toBe(0);
		expect(firstStop([true, true])).toBe(-1);
	});

	it("starts on the first line that isn't a heading", () => {
		expect(firstStop(grouped)).toBe(1);
		expect(firstStop(flat)).toBe(0);
	});
});

describe("scrollWindow", () => {
	it("starts at the top", () => {
		expect(scrollWindow(flat, 0, 0, 5)).toBe(0);
	});

	it("stays put while the cursor moves inside it", () => {
		expect(scrollWindow(flat, 4, 0, 5)).toBe(0);
		expect(scrollWindow(flat, 3, 3, 5)).toBe(3);
	});

	it("follows the cursor down past its last line, a line at a time", () => {
		expect(scrollWindow(flat, 5, 0, 5)).toBe(1);
		expect(scrollWindow(flat, 9, 4, 5)).toBe(5);
	});

	it("follows the cursor up past its first line", () => {
		expect(scrollWindow(flat, 2, 3, 5)).toBe(2);
	});

	it("jumps to either end when the cursor wraps", () => {
		expect(scrollWindow(flat, 0, 5, 5)).toBe(0);
		expect(scrollWindow(flat, 9, 0, 5)).toBe(5);
	});

	it("shows everything from the top when it all fits", () => {
		expect(scrollWindow(flat, 9, 0, 12)).toBe(0);
	});

	it("brings the cursor's heading into view while both fit", () => {
		expect(scrollWindow(grouped, 4, 5, 4)).toBe(3);
		expect(scrollWindow(grouped, 1, 3, 4)).toBe(0);
	});

	it("lets the heading go when the group is longer than the window", () => {
		expect(scrollWindow(grouped, 8, 3, 4)).toBe(5);
		expect(scrollWindow(grouped, 7, 5, 4)).toBe(5);
	});
});
