import { describe, expect, it } from "vitest";
import {
	formatElapsed,
	renderCancel,
	renderClose,
} from "../../src/terminal/close.js";
import { createStyle } from "../../src/terminal/style.js";
import type { TallyItem } from "../../src/terminal/types.js";

const plain = createStyle(0);
const gap = (columns: number) => " ".repeat(columns);
const rule = (width: number) => ` ${"─".repeat(width - 2)}`;

const update: TallyItem[] = [
	{ count: 3, label: "updated", status: "done" },
	{ count: 2, label: "up to date", status: "unchanged" },
	{ count: 1, label: "not checked", status: "attention" },
	{ count: 1, label: "not updated", status: "failed" },
];
const UPDATE_TALLY =
	"3 updated  ·  2 up to date  ·  1 not checked  ·  1 not updated";

describe("renderClose", () => {
	it.each([
		[80, 12],
		[100, 32],
	])("draws the rule across the width, then the tally and time at %i", (width, spaces) => {
		expect(renderClose(update, 2400, width, plain)).toEqual([
			"",
			rule(width),
			` ${UPDATE_TALLY}${gap(spaces)}2.4s`,
		]);
	});

	it("breaks the tally between counts to fit, the time on its last line", () => {
		expect(renderClose(update, 2400, 40, plain)).toEqual([
			"",
			rule(40),
			" 3 updated  ·  2 up to date",
			" 1 not checked  ·  1 not updated   2.4s",
		]);
	});

	it("gives the time a line of its own when the tally leaves no room", () => {
		expect(
			renderClose(
				[
					{
						count: 10,
						label: "up to date, pinned with newer tags",
						status: "unchanged",
					},
				],
				2400,
				40,
				plain,
			),
		).toEqual([
			"",
			rule(40),
			" 10 up to date, pinned with newer tags",
			`${gap(35)}2.4s`,
		]);
	});

	it("leaves out zero counts", () => {
		expect(
			renderClose(
				[
					{ count: 0, label: "updated", status: "done" },
					{ count: 2, label: "up to date", status: "unchanged" },
					{ count: 0, label: "failed", status: "failed" },
				],
				undefined,
				80,
				plain,
			),
		).toEqual(["", rule(80), " 2 up to date"]);
	});

	it("leaves out the time when none is given", () => {
		expect(renderClose(update, undefined, 80, plain)).toEqual([
			"",
			rule(80),
			` ${UPDATE_TALLY}`,
		]);
	});

	it("paints the rule, separators and time dim, each count in its status's colour", () => {
		expect(
			renderClose(
				[
					{ count: 1, label: "updated", status: "done" },
					{ count: 2, label: "up to date", status: "unchanged" },
					{ count: 1, label: "failed", status: "failed" },
					{ count: 1, label: "not checked", status: "attention" },
				],
				72_000,
				80,
				createStyle(3),
			),
		).toEqual([
			"",
			` \x1b[2m${"─".repeat(78)}\x1b[22m`,
			` \x1b[32m1 updated\x1b[39m\x1b[2m  ·  \x1b[22m\x1b[2m2 up to date\x1b[22m\x1b[2m  ·  \x1b[22m\x1b[31m1 failed\x1b[39m\x1b[2m  ·  \x1b[22m\x1b[33m1 not checked\x1b[39m${gap(15)}\x1b[2m1m 12s\x1b[22m`,
		]);
	});
});

describe("formatElapsed", () => {
	it.each([
		[0, "0.1s"],
		[40, "0.1s"],
		[2400, "2.4s"],
		[2449, "2.4s"],
		[59_940, "59.9s"],
		[59_950, "1m 0s"],
		[60_000, "1m 0s"],
		[72_000, "1m 12s"],
		[3_725_000, "62m 5s"],
	])("reads %i ms as %s", (ms, text) => {
		expect(formatElapsed(ms)).toBe(text);
	});
});

describe("renderCancel", () => {
	it("says Cancelled by default", () => {
		expect(renderCancel(80, plain)).toEqual([" ○ Cancelled"]);
	});

	it("says the caller's words, wrapped at column 3", () => {
		expect(
			renderCancel(
				40,
				plain,
				"Nothing was removed, and every entry is still recorded",
			),
		).toEqual([
			" ○ Nothing was removed, and every entry",
			"   is still recorded",
		]);
	});

	it("is dim", () => {
		expect(renderCancel(80, createStyle(3))).toEqual([
			" \x1b[2m○ Cancelled\x1b[22m",
		]);
	});
});
