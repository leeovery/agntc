import { describe, expect, it } from "vitest";
import { linesAbove, optionText } from "../../../src/terminal/prompts/lines.js";
import { createStyle } from "../../../src/terminal/style.js";

const plain = createStyle(0);
const choice = { value: "x", label: "x", hint: "skill" };

describe("optionText", () => {
	it.each([
		[8, "x  skill"],
		[5, "x  s…"],
		[4, "x"],
		[3, "x"],
	])("fits the hint in the room left, leaving out one that would be only its …, in %i columns", (room, text) => {
		expect(optionText(choice, 3, room, plain, false)).toBe(text);
	});

	it("cuts a label at its start to end two short of the hint's column", () => {
		expect(
			optionText(
				{ value: "x", label: "owner/repo/a-long-skill", hint: "skill" },
				12,
				30,
				plain,
				false,
			),
		).toBe("…ong-skill  skill");
	});

	it("leaves out a hint that would cut the label below ten columns, its inset with them, the label taking the room", () => {
		const named = { value: "x", label: "a-skill-02", hint: "Menu of things" };
		expect(optionText(named, 9, 14, plain, false)).toBe("a-skill-02");
		expect(optionText(named, 12, 20, plain, false)).toBe(
			"a-skill-02  Menu of…",
		);
		expect(optionText({ ...named, label: "ab" }, 9, 14, plain, false)).toBe(
			"ab       Menu…",
		);
	});

	it("puts a label's aside a space after it, dim, the label bold on the cursor's row", () => {
		const shared = {
			value: "x",
			label: "laravel",
			aside: "skills/laravel",
			hint: "skill",
		};
		expect(optionText(shared, 25, 40, plain, false)).toBe(
			"laravel skills/laravel   skill",
		);
		expect(optionText(shared, 25, 40, createStyle(3), true)).toBe(
			"\x1b[1mlaravel\x1b[22m \x1b[2mskills/laravel\x1b[22m   \x1b[2mskill\x1b[22m",
		);
	});

	it("leaves out an aside that won't fit beside its label, the label kept whole where it fits", () => {
		const shared = {
			value: "x",
			label: "laravel",
			aside: "skills/laravel",
			hint: "skill",
		};
		expect(optionText(shared, 14, 30, plain, false)).toBe(
			"laravel       skill",
		);
		expect(
			optionText({ ...shared, hint: undefined }, 14, 21, plain, false),
		).toBe("laravel");
		expect(
			optionText({ ...shared, hint: undefined }, 14, 22, plain, false),
		).toBe("laravel skills/laravel");
	});

	it("leaves a label's inset out of its room", () => {
		expect(
			optionText(
				{ value: "x", label: "owner/repo/a-long-skill", hint: "skill" },
				12,
				30,
				plain,
				false,
				2,
			),
		).toBe("  …g-skill  skill");
	});
});

describe("linesAbove", () => {
	const ROW = [" ✓ owner/repo", "   └─ a", ""];

	it("gives the room to the question's above, and takes what it gives", () => {
		const above = (room: number) => ROW.slice(0, room);

		expect(linesAbove(above, 3)).toEqual(ROW);
		expect(linesAbove(above, 2)).toEqual(ROW.slice(0, 2));
	});

	it("never takes more lines than the room, so the frame can't overflow", () => {
		expect(linesAbove(() => ROW, 2)).toEqual(ROW.slice(0, 2));
	});

	it("asks for nothing without room, or without an above", () => {
		expect(linesAbove(() => ROW, 0)).toEqual([]);
		expect(linesAbove(undefined, 5)).toEqual([]);
	});
});
