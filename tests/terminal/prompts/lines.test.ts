import { describe, expect, it } from "vitest";
import { aboveLines, optionText } from "../../../src/terminal/prompts/lines.js";
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

describe("aboveLines", () => {
	const ROW = [" ✓ owner/repo", "   · a", "   · b", "   · c", ""];

	it("keeps every line while the screen has room for them and the rest of the frame", () => {
		expect(aboveLines(ROW, 3, 9, 80, plain)).toEqual(ROW);
	});

	it("cuts them from their end, the last line kept counting those that went", () => {
		expect(aboveLines(ROW, 3, 7, 80, plain)).toEqual([
			" ✓ owner/repo",
			"   · a",
			"   … 3 more",
		]);
	});

	it("keeps only the count when one line is all the room there is", () => {
		expect(aboveLines(ROW, 3, 5, 80, plain)).toEqual(["   … 5 more"]);
	});

	it("leaves them all out when the rest of the frame takes the screen", () => {
		expect(aboveLines(ROW, 3, 4, 80, plain)).toEqual([]);
	});

	it("paints the count dim", () => {
		expect(aboveLines(ROW, 3, 5, 80, createStyle(3))).toEqual([
			"   \x1b[2m… 5 more\x1b[22m",
		]);
	});
});
