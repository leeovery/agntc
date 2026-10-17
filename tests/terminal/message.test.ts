import { describe, expect, it } from "vitest";
import type { RichMessage } from "../../src/message.js";
import { renderMessage } from "../../src/terminal/message.js";
import { createStyle } from "../../src/terminal/style.js";

const plain = createStyle(0);
const color = createStyle(3);
const ACCENT = "\x1b[38;2;167;139;250m";

const STRAY_COMMAND = "npx agntc add leeovery/agentic-skills/examples --pack";
const stray: RichMessage = {
	text: "examples has agents/ that won't be installed.",
	remedy: {
		lead: "To install them as a pack:",
		steps: [{ command: STRAY_COMMAND }],
	},
	plain: "unused by the renderer",
};

const candidates: RichMessage = {
	text: "laravel can't be updated.",
	remedy: {
		lead: "To follow one of them:",
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
	plain: "unused by the renderer",
};

describe("renderMessage", () => {
	it.each([80, 100])("opens a warn with ! at %i", (width) => {
		expect(
			renderMessage("warn", "Some files were left behind", width, plain),
		).toEqual([" ! Some files were left behind"]);
	});

	it("opens a note with ·", () => {
		expect(
			renderMessage("note", "laravel is already in a pack", 80, plain),
		).toEqual([" · laravel is already in a pack"]);
	});

	it("opens an error with ✗ and puts its cause on the next line", () => {
		expect(
			renderMessage(
				"error",
				{
					text: "couldn't clone owner/repo",
					cause: "repository not found",
					plain: "unused",
				},
				80,
				plain,
			),
		).toEqual([" ✗ couldn't clone owner/repo", "   repository not found"]);
	});

	it("wraps the text and its cause, continuing at column 3", () => {
		expect(
			renderMessage(
				"error",
				{
					text: "examples has agents/ that won't be installed as they stand here",
					cause: "fatal: could not read Username for https://github.com",
					plain: "unused",
				},
				40,
				plain,
			),
		).toEqual([
			" ✗ examples has agents/ that won't be",
			"   installed as they stand here",
			"   fatal: could not read Username for",
			"   https://github.com",
		]);
	});

	it.each([
		80, 100,
	])("puts a remedy's lead at column 3 and its command at 5 at %i", (width) => {
		expect(renderMessage("warn", stray, width, plain)).toEqual([
			" ! examples has agents/ that won't be installed.",
			"   To install them as a pack:",
			`     ${STRAY_COMMAND}`,
		]);
	});

	it("never wraps or cuts a command, however narrow", () => {
		expect(renderMessage("warn", stray, 40, plain)).toEqual([
			" ! examples has agents/ that won't be",
			"   installed.",
			"   To install them as a pack:",
			`     ${STRAY_COMMAND}`,
		]);
	});

	it("puts a dim then one of between a step and a choice", () => {
		expect(renderMessage("error", candidates, 80, plain)).toEqual([
			" ✗ laravel can't be updated.",
			"   To follow one of them:",
			"     npx agntc remove o/r/laravel",
			"     then one of",
			"     npx agntc add o/r --skill a/laravel",
			"     npx agntc add o/r --skill b/laravel",
		]);
	});

	it("opens a choice that comes first with one of", () => {
		expect(
			renderMessage(
				"warn",
				{
					text: "Several skills are named laravel.",
					remedy: {
						lead: "To add one:",
						steps: [{ choice: ["npx agntc add o/r/a", "npx agntc add o/r/b"] }],
					},
					plain: "unused",
				},
				80,
				plain,
			),
		).toEqual([
			" ! Several skills are named laravel.",
			"   To add one:",
			"     one of",
			"     npx agntc add o/r/a",
			"     npx agntc add o/r/b",
		]);
	});

	it("wraps a words step at column 5", () => {
		expect(
			renderMessage(
				"warn",
				{
					text: "Left as it is.",
					remedy: {
						lead: "Otherwise:",
						steps: [
							{
								words:
									"Or keep the install as it is, and nothing changes at all.",
							},
						],
					},
					plain: "unused",
				},
				40,
				plain,
			),
		).toEqual([
			" ! Left as it is.",
			"   Otherwise:",
			"     Or keep the install as it is, and",
			"     nothing changes at all.",
		]);
	});

	describe("in colour", () => {
		it("paints a warn's glyph yellow and leaves its text plain", () => {
			expect(renderMessage("warn", "careful", 80, color)).toEqual([
				" \x1b[33m!\x1b[39m careful",
			]);
		});

		it("paints a note's glyph dim", () => {
			expect(renderMessage("note", "aside", 80, color)).toEqual([
				" \x1b[2m·\x1b[22m aside",
			]);
		});

		it("paints an error's glyph red, its text bold on every line and its cause dim", () => {
			expect(
				renderMessage(
					"error",
					{
						text: "examples has agents/ that won't be installed",
						cause: "not found",
						plain: "unused",
					},
					40,
					color,
				),
			).toEqual([
				" \x1b[31m✗\x1b[39m \x1b[1mexamples has agents/ that won't be\x1b[22m",
				"   \x1b[1minstalled\x1b[22m",
				"   \x1b[2mnot found\x1b[22m",
			]);
		});

		it("paints commands in the accent and the choice line dim", () => {
			expect(renderMessage("error", candidates, 80, color).slice(1)).toEqual([
				"   To follow one of them:",
				`     ${ACCENT}npx agntc remove o/r/laravel\x1b[39m`,
				"     \x1b[2mthen one of\x1b[22m",
				`     ${ACCENT}npx agntc add o/r --skill a/laravel\x1b[39m`,
				`     ${ACCENT}npx agntc add o/r --skill b/laravel\x1b[39m`,
			]);
		});
	});
});

describe("a string", () => {
	it("wraps as a rich text does, from column 3", () => {
		expect(
			renderMessage(
				"note",
				"owner/repo/kit moved from skills/old/kit to skills/new/kit, now keyed owner/repo/kit",
				40,
				plain,
			),
		).toEqual([
			" · owner/repo/kit moved from",
			"   skills/old/kit to skills/new/kit,",
			"   now keyed owner/repo/kit",
		]);
	});

	it("as an error, bolds its first line and dims the rest, its cause, both wrapped", () => {
		expect(
			renderMessage(
				"error",
				"Failed to read manifest: Unexpected token } in JSON\nat position 12 of .agntc/manifest.json, the project's",
				40,
				color,
			),
		).toEqual([
			" \x1b[31m✗\x1b[39m \x1b[1mFailed to read manifest: Unexpected\x1b[22m",
			"   \x1b[1mtoken } in JSON\x1b[22m",
			"   \x1b[2mat position 12 of\x1b[22m",
			"   \x1b[2m.agntc/manifest.json, the project's\x1b[22m",
		]);
	});

	it("leaves a warning's later lines its own, not a cause", () => {
		expect(renderMessage("warn", "first\nsecond", 80, color)).toEqual([
			" \x1b[33m!\x1b[39m first",
			"   second",
		]);
	});

	it("leaves off the blank lines it ends with", () => {
		expect(
			renderMessage(
				"error",
				"Could not clone\nfatal: not found\n\n",
				80,
				plain,
			),
		).toEqual([" ✗ Could not clone", "   fatal: not found"]);
	});
});
