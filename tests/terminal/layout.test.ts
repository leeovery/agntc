import { describe, expect, it } from "vitest";
import {
	isNarrow,
	layoutWidth,
	pad,
	padStart,
	spread,
	truncate,
	truncateStart,
	visibleWidth,
	wrap,
} from "../../src/terminal/layout.js";

describe("visibleWidth", () => {
	it.each([
		["plain text", "abc", 3],
		["text inside SGR codes", "\x1b[1mabc\x1b[22m", 3],
		["a truecolor glyph", "\x1b[38;2;167;139;250m■\x1b[39m", 1],
		["nested codes", "\x1b[32m\x1b[1mok\x1b[22m\x1b[39m", 2],
		["CJK ideographs as two each", "日本語", 6],
		["fullwidth forms as two", "ＡＢ", 4],
		["hangul as two", "한글", 4],
		["a combining mark as nothing", "é", 1],
		["a zero-width joiner as nothing", "a‍b", 2],
		["an emoji as two", "🚀", 2],
		["devanagari with its marks as one each", "नमस्ते", 4],
		["a thai consonant and its tone mark as one", "ก่", 1],
		["a ZWJ family as two", "👨‍👩‍👧", 2],
		["an emoji asked for by VS16 as two", "❤️", 2],
		["a skin-toned emoji as two", "👍🏽", 2],
		["a flag as two", "🇬🇧", 2],
		["an emoji-presentation symbol as two", "✅", 2],
		["text-presentation glyphs as one", "✓✗○●↑·!■", 8],
		["box drawing as one", "├─└─", 4],
		["braille as one", "⠁⠂⠄⡀", 4],
	])("counts %s", (_name, text, width) => {
		expect(visibleWidth(text)).toBe(width);
	});
});

describe("pad and padStart", () => {
	it("pads to the visible width, escape codes aside", () => {
		expect(pad("\x1b[1mab\x1b[22m", 5)).toBe("\x1b[1mab\x1b[22m   ");
		expect(padStart("\x1b[1mab\x1b[22m", 5)).toBe("   \x1b[1mab\x1b[22m");
	});

	it("counts wide characters as two", () => {
		expect(pad("日本", 6)).toBe("日本  ");
	});

	it("leaves text already as wide as asked", () => {
		expect(pad("abcdef", 3)).toBe("abcdef");
		expect(padStart("abcdef", 3)).toBe("abcdef");
	});
});

describe("truncate", () => {
	it("leaves text that fits", () => {
		expect(truncate("abcdef", 6)).toBe("abcdef");
	});

	it("cuts the end and marks it with an ellipsis", () => {
		expect(truncate("abcdefgh", 6)).toBe("abcde…");
	});

	it("never splits a wide character", () => {
		expect(truncate("日本語", 4)).toBe("日…");
	});

	it("keeps every escape code, those past the cut too", () => {
		expect(truncate("\x1b[2mabc\x1b[22m \x1b[1mdefgh\x1b[22m", 6)).toBe(
			"\x1b[2mabc\x1b[22m \x1b[1md\x1b[22m…",
		);
	});

	it("never splits a grapheme cluster", () => {
		expect(truncate("ab👨‍👩‍👧cd", 4)).toBe("ab…");
	});

	it("cuts the start with truncateStart", () => {
		expect(truncateStart("~/Code/project/name", 10)).toBe("…ject/name");
	});
});

describe("spread", () => {
	it("ends the right side at the right margin", () => {
		expect(spread("ab", "cd", 10)).toBe("ab     cd");
	});

	it("needs a gap of two", () => {
		expect(spread("abc", "def", 9)).toBe("abc  def");
		expect(spread("abc", "def", 8)).toBeUndefined();
	});
});

describe("wrap", () => {
	it("breaks at spaces inside the width", () => {
		expect(wrap("the quick brown fox jumps", 10)).toEqual([
			"the quick",
			"brown fox",
			"jumps",
		]);
	});

	it("keeps a word that fills the line exactly", () => {
		expect(wrap("abcde fghij", 5)).toEqual(["abcde", "fghij"]);
	});

	it("hard-breaks a word longer than the width", () => {
		expect(wrap("go abcdefghijkl end", 5)).toEqual([
			"go",
			"abcde",
			"fghij",
			"kl",
			"end",
		]);
	});

	it("wraps the first line to its own width", () => {
		expect(wrap("one two three four", 10, 4)).toEqual([
			"one",
			"two three",
			"four",
		]);
	});

	it("starts the next line when the first word can't fit the first line", () => {
		expect(wrap("seven eight", 10, 3)).toEqual(["", "seven", "eight"]);
	});

	it("keeps paragraphs apart", () => {
		expect(wrap("one two\nthree", 20)).toEqual(["one two", "three"]);
	});

	it("collapses runs of spaces", () => {
		expect(wrap("one   two", 20)).toEqual(["one two"]);
	});

	it("gives one empty line for empty text", () => {
		expect(wrap("", 20)).toEqual([""]);
	});

	it("measures wide characters as two", () => {
		expect(wrap("日本 語語", 4)).toEqual(["日本", "語語"]);
	});
});

describe("layoutWidth and isNarrow", () => {
	it("is the terminal's width, at most 100", () => {
		expect(layoutWidth(72)).toBe(72);
		expect(layoutWidth(160)).toBe(100);
	});

	it("is 80 when the terminal gives no width, or 0", () => {
		expect(layoutWidth()).toBe(80);
		expect(layoutWidth(0)).toBe(80);
	});

	it("is at least 20", () => {
		expect(layoutWidth(12)).toBe(20);
	});

	it("is narrow below 60", () => {
		expect(isNarrow(59)).toBe(true);
		expect(isNarrow(60)).toBe(false);
	});
});
