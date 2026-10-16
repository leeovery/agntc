import { describe, expect, it } from "vitest";
import { renderNext } from "../../src/terminal/next.js";
import { createStyle } from "../../src/terminal/style.js";
import type { NextItem } from "../../src/terminal/types.js";

const plain = createStyle(0);

const abort: NextItem = {
	subject: "macos",
	remedy: {
		lead: "To update it anyway:",
		steps: [
			{ command: "npx agntc remove o/r/macos" },
			{ command: "npx agntc add o/r@^1.4.0 --skill macos" },
		],
	},
};

const upgrade: NextItem = {
	subject: "o/r",
	remedy: {
		lead: "Its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
		steps: [{ command: "npx agntc add o/r" }],
	},
};

describe("renderNext", () => {
	it("prints nothing without items", () => {
		expect(renderNext([], 80, plain)).toEqual([]);
	});

	it.each([
		80, 100,
	])("opens with a blank line and Next, the items a blank line apart, at %i", (width) => {
		expect(renderNext([abort, upgrade], width, plain)).toEqual([
			"",
			" Next",
			"   macos — to update it anyway:",
			"     npx agntc remove o/r/macos",
			"     npx agntc add o/r@^1.4.0 --skill macos",
			"",
			"   o/r — its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
			"     npx agntc add o/r",
		]);
	});

	it("wraps the heading at column 3", () => {
		expect(
			renderNext(
				[
					{
						subject: "laravel",
						remedy: {
							lead: "Its SKILL.md is gone and 2 skills are now named laravel. To follow one:",
							steps: [
								{ command: "npx agntc remove o/r/laravel" },
								{
									choice: [
										"npx agntc add o/r --skill a/laravel",
										"npx agntc add o/r --skill b/laravel",
									],
								},
							],
						},
					},
				],
				40,
				plain,
			),
		).toEqual([
			"",
			" Next",
			"   laravel — its SKILL.md is gone and 2",
			"   skills are now named laravel. To",
			"   follow one:",
			"     npx agntc remove o/r/laravel",
			"     then one of",
			"     npx agntc add o/r --skill a/laravel",
			"     npx agntc add o/r --skill b/laravel",
		]);
	});

	it("wraps a subject too long for its line, the lead running on from it", () => {
		expect(
			renderNext(
				[{ ...abort, subject: "owner/a-very-long-repository-name-here" }],
				40,
				plain,
			).slice(2, 4),
		).toEqual([
			"   owner/a-very-long-repository-name-he",
			"   re — to update it anyway:",
		]);
	});

	it("leaves the dash out without a lead", () => {
		expect(
			renderNext(
				[
					{
						subject: "macos",
						remedy: {
							lead: "",
							steps: [{ command: "npx agntc update macos" }],
						},
					},
				],
				80,
				plain,
			),
		).toEqual(["", " Next", "   macos", "     npx agntc update macos"]);
	});

	it("paints Next and the subject bold and commands in the accent", () => {
		expect(renderNext([upgrade], 80, createStyle(3))).toEqual([
			"",
			" \x1b[1mNext\x1b[22m",
			"   \x1b[1mo/r\x1b[22m — its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
			"     \x1b[38;2;167;139;250mnpx agntc add o/r\x1b[39m",
		]);
	});
});
