import { describe, expect, it } from "vitest";
import { optionText } from "../../../src/terminal/prompts/lines.js";
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
});
