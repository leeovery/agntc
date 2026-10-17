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

	it("leads the hint with the aside and ` · `, all dim, the label bold on the cursor's row", () => {
		const shared = {
			value: "x",
			label: "testing",
			aside: "skills/frontend",
			hint: "Generic advice",
		};
		expect(optionText(shared, 10, 60, plain, false)).toBe(
			"testing   skills/frontend · Generic advice",
		);
		expect(optionText(shared, 10, 60, createStyle(3), true)).toBe(
			"\x1b[1mtesting\x1b[22m   \x1b[2mskills/frontend · Generic advice\x1b[22m",
		);
	});

	it("cuts the hint first, then the aside at its start, keeping the folder nearest the name", () => {
		const shared = {
			value: "x",
			label: "testing",
			aside: "skills/frontend",
			hint: "Generic advice",
		};
		expect(optionText(shared, 10, 32, plain, false)).toBe(
			"testing   skills/frontend · Gen…",
		);
		expect(optionText(shared, 10, 30, plain, false)).toBe(
			"testing   skills/frontend · G…",
		);
		expect(optionText(shared, 10, 29, plain, false)).toBe(
			"testing   skills/frontend",
		);
		expect(optionText(shared, 10, 25, plain, false)).toBe(
			"testing   skills/frontend",
		);
		expect(optionText(shared, 10, 24, plain, false)).toBe(
			"testing   …ills/frontend",
		);
		expect(optionText(shared, 10, 13, plain, false)).toBe("testing   …nd");
	});

	it("leaves the aside out only when fewer than three columns are left for it, its hint with it", () => {
		const shared = { value: "x", label: "testing", aside: "skills" };
		expect(optionText(shared, 10, 12, plain, false)).toBe("testing");
		expect(optionText({ ...shared, aside: "a" }, 10, 12, plain, false)).toBe(
			"testing",
		);
		expect(
			optionText({ ...shared, hint: "Generic" }, 10, 12, plain, false),
		).toBe("testing");
		expect(optionText({ ...shared, aside: "a" }, 10, 13, plain, false)).toBe(
			"testing   a",
		);
	});

	it("keeps the aside where the label's floor leaves the column no room, two past the label cut to its floor, the hint left out", () => {
		const twin = {
			value: "x",
			label: "eloquent-models",
			aside: "laravel",
			hint: "Models",
		};
		expect(optionText(twin, 9, 20, plain, false)).toBe("…nt-models  laravel");
		expect(optionText(twin, 9, 16, plain, false)).toBe("…nt-models  …vel");
		expect(optionText(twin, 9, 15, plain, false)).toBe("…nt-models  …el");
		expect(optionText(twin, 9, 14, plain, false)).toBe("…oquent-models");
		expect(optionText({ ...twin, aside: undefined }, 9, 20, plain, false)).toBe(
			"eloquent-models",
		);
	});

	it("never widens the label's column", () => {
		const shared = { value: "x", label: "go", aside: "skills/a-long-path" };
		expect(optionText(shared, 5, 40, plain, false)).toBe(
			"go   skills/a-long-path",
		);
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
