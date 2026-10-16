import { describe, expect, it } from "vitest";
import {
	firstStop,
	scrollWindow,
	stepCursor,
	windowSize,
} from "../../../src/terminal/prompts/list-window.js";

/** Ten options, none a heading. */
const flat = Array.from({ length: 10 }, () => false);
/** Two groups: a heading over two options, then a heading over five. */
const grouped = [true, false, false, true, false, false, false, false, false];

describe("windowSize", () => {
	it("takes the prompt's own number", () => {
		expect(windowSize(3, 40, 6)).toBe(3);
	});

	it("leaves the reserved lines of the terminal's rows", () => {
		expect(windowSize(undefined, 30, 6)).toBe(24);
		expect(windowSize(undefined, 30, 8)).toBe(22);
	});

	it("reads 24 rows when the terminal gives none", () => {
		expect(windowSize(undefined, undefined, 6)).toBe(18);
		expect(windowSize(undefined, 0, 6)).toBe(18);
	});

	it("never shows fewer than 5 lines for a short terminal, nor fewer than 1", () => {
		expect(windowSize(undefined, 8, 6)).toBe(5);
		expect(windowSize(0, 30, 6)).toBe(1);
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
