import { describe, expect, it } from "vitest";
import { renderBanner } from "../src/banner.js";
import { createStyle } from "../src/terminal/style.js";

const plain = createStyle(0);
const ACCENT = "\x1b[38;2;167;139;250m";

describe("renderBanner", () => {
	it("includes the prefixed version when given", () => {
		expect(renderBanner("1.2.3", plain)).toContain("v1.2.3");
	});

	it("omits the version suffix when none is given (dev placeholder hidden)", () => {
		const out = renderBanner(undefined, plain);
		expect(out).not.toMatch(/v\d/); // no "v1.2.3"-style suffix
		// still renders the art + tagline
		expect(out).toContain("█");
		expect(out).toContain("agent skills installer");
	});

	it("includes the tagline naming claude", () => {
		const out = renderBanner("0.0.1", plain);
		expect(out).toContain("agent skills installer for claude");
	});

	it("renders the solid block art (six glyph rows)", () => {
		const out = renderBanner("0.0.1", plain);
		expect(out).toContain("█");
		// Every art row carries at least one block/shadow glyph; the final row is
		// all shadow chars (no █), so match the full glyph set, not just █.
		const glyphRows = out.split("\n").filter((l) => /[█╔╗╚╝═║]/.test(l));
		expect(glyphRows).toHaveLength(6);
	});

	it("frames the output with leading and trailing blank lines", () => {
		const lines = renderBanner("0.0.1", plain).split("\n");
		expect(lines[0]).toBe("");
		expect(lines.at(-1)).toBe("");
	});

	it("draws the blocks in the accent, the shadow in the accent dimmed, the tagline and version dim", () => {
		const lines = renderBanner("1.2.3", createStyle(3)).split("\n");
		expect(lines[1]).toBe(
			`   ${ACCENT}█████\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m  ${ACCENT}██████\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m ${ACCENT}███\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m   ${ACCENT}██\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m${ACCENT}████████\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m ${ACCENT}██████\x1b[39m\x1b[2m${ACCENT}╗\x1b[39m\x1b[22m`,
		);
		expect(lines.at(-2)).toBe(
			"  \x1b[2magent skills installer for claude\x1b[22m  \x1b[2mv1.2.3\x1b[22m",
		);
	});

	it("is plain without colour", () => {
		expect(renderBanner("1.2.3", plain)).not.toContain("\x1b[");
	});
});
