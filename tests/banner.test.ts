import { describe, expect, it } from "vitest";
import { renderBanner } from "../src/banner.js";

// Strip ANSI so assertions hold regardless of whether picocolors emits color
// (it auto-disables for the non-TTY test runner, but be robust either way).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderBanner", () => {
	it("includes the prefixed version when given", () => {
		expect(stripAnsi(renderBanner("1.2.3"))).toContain("v1.2.3");
	});

	it("omits the version suffix when none is given (dev placeholder hidden)", () => {
		const out = stripAnsi(renderBanner());
		expect(out).not.toMatch(/v\d/); // no "v1.2.3"-style suffix
		// still renders the art + tagline
		expect(out).toContain("█");
		expect(out).toContain("agent skills installer");
	});

	it("includes the tagline naming all three agents", () => {
		const out = stripAnsi(renderBanner("0.0.1"));
		expect(out).toContain("agent skills installer");
		expect(out).toContain("claude");
		expect(out).toContain("codex");
		expect(out).toContain("cursor");
	});

	it("renders the solid block art (six glyph rows)", () => {
		const out = stripAnsi(renderBanner("0.0.1"));
		expect(out).toContain("█");
		// Every art row carries at least one block/shadow glyph; the final row is
		// all shadow chars (no █), so match the full glyph set, not just █.
		const glyphRows = out.split("\n").filter((l) => /[█╔╗╚╝═║]/.test(l));
		expect(glyphRows).toHaveLength(6);
	});

	it("frames the output with leading and trailing blank lines", () => {
		const lines = renderBanner("0.0.1").split("\n");
		expect(lines[0]).toBe("");
		expect(lines.at(-1)).toBe("");
	});
});
