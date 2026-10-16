import { describe, expect, it } from "vitest";
import {
	type ColorLevel,
	createStyle,
	detectColorLevel,
	statusGlyph,
} from "../../src/terminal/style.js";
import type { Status } from "../../src/terminal/types.js";

describe("detectColorLevel", () => {
	it.each<[string, Record<string, string>, boolean, ColorLevel]>([
		["a non-empty NO_COLOR", { NO_COLOR: "1", TERM: "xterm" }, true, 0],
		["NO_COLOR over FORCE_COLOR", { NO_COLOR: "1", FORCE_COLOR: "3" }, true, 0],
		["an empty NO_COLOR as unset", { NO_COLOR: "", TERM: "xterm" }, true, 1],
		["FORCE_COLOR=0", { FORCE_COLOR: "0", TERM: "xterm" }, true, 0],
		["FORCE_COLOR=false", { FORCE_COLOR: "false", TERM: "xterm" }, true, 0],
		["FORCE_COLOR=1 off a terminal", { FORCE_COLOR: "1" }, false, 1],
		["FORCE_COLOR=2 off a terminal", { FORCE_COLOR: "2" }, false, 2],
		["FORCE_COLOR=3 off a terminal", { FORCE_COLOR: "3" }, false, 3],
		["an empty FORCE_COLOR", { FORCE_COLOR: "" }, false, 1],
		["FORCE_COLOR=true", { FORCE_COLOR: "true" }, false, 1],
		["any other FORCE_COLOR as on", { FORCE_COLOR: "yes" }, false, 1],
		["FORCE_COLOR over TERM=dumb", { FORCE_COLOR: "2", TERM: "dumb" }, true, 2],
		["no terminal", { COLORTERM: "truecolor" }, false, 0],
		["TERM=dumb", { TERM: "dumb", COLORTERM: "truecolor" }, true, 0],
		["COLORTERM=truecolor", { COLORTERM: "truecolor", TERM: "xterm" }, true, 3],
		["COLORTERM=24bit", { COLORTERM: "24bit" }, true, 3],
		[
			"COLORTERM over a 256 TERM",
			{ COLORTERM: "truecolor", TERM: "xterm-256color" },
			true,
			3,
		],
		["a 256 TERM", { TERM: "xterm-256color" }, true, 2],
		["a plain TERM", { TERM: "xterm" }, true, 1],
		["a terminal with nothing set", {}, true, 1],
	])("reads %s", (_name, env, isTTY, level) => {
		expect(detectColorLevel(env, isTTY)).toBe(level);
	});
});

describe("createStyle", () => {
	it.each([
		["bold", "\x1b[1mx\x1b[22m"],
		["dim", "\x1b[2mx\x1b[22m"],
		["good", "\x1b[32mx\x1b[39m"],
		["attention", "\x1b[33mx\x1b[39m"],
		["bad", "\x1b[31mx\x1b[39m"],
		["accent", "\x1b[38;2;167;139;250mx\x1b[39m"],
	] as const)("paints %s at truecolor", (painter, painted) => {
		expect(createStyle(3)[painter]("x")).toBe(painted);
	});

	it("paints the accent as the nearest xterm-256 colour at level 2", () => {
		expect(createStyle(2).accent("x")).toBe("\x1b[38;5;141mx\x1b[39m");
	});

	it("paints the accent magenta at level 1", () => {
		expect(createStyle(1).accent("x")).toBe("\x1b[35mx\x1b[39m");
	});

	it("keeps the terminal's own colours for statuses at every level", () => {
		for (const level of [1, 2, 3] as const) {
			expect(createStyle(level).good("x")).toBe("\x1b[32mx\x1b[39m");
		}
	});

	it("paints nothing at level 0", () => {
		const style = createStyle(0);
		for (const painter of [
			style.bold,
			style.dim,
			style.good,
			style.attention,
			style.bad,
			style.accent,
		]) {
			expect(painter("x")).toBe("x");
		}
	});

	it("nests, as no painter closes with a full reset", () => {
		const style = createStyle(3);
		expect(style.good(style.bold("x"))).toBe(
			"\x1b[32m\x1b[1mx\x1b[22m\x1b[39m",
		);
	});
});

describe("statusGlyph", () => {
	it.each<[Status, string]>([
		["done", "\x1b[32m✓\x1b[39m"],
		["unchanged", "\x1b[2m○\x1b[22m"],
		["attention", "\x1b[33m!\x1b[39m"],
		["failed", "\x1b[31m✗\x1b[39m"],
		["subject", "\x1b[38;2;167;139;250m●\x1b[39m"],
		["newer", "\x1b[38;2;167;139;250m↑\x1b[39m"],
		["note", "\x1b[2m·\x1b[22m"],
	])("paints %s's glyph", (status, glyph) => {
		expect(statusGlyph(status, createStyle(3))).toBe(glyph);
	});

	it.each<[Status, string]>([
		["done", "✓"],
		["unchanged", "○"],
		["attention", "!"],
		["failed", "✗"],
		["subject", "●"],
		["newer", "↑"],
		["note", "·"],
	])("gives %s its glyph by shape alone without colour", (status, glyph) => {
		expect(statusGlyph(status, createStyle(0))).toBe(glyph);
	});
});
