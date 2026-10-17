import { describe, expect, it } from "vitest";
import {
	fitAside,
	isNarrow,
	layoutWidth,
	pad,
	padStart,
	spread,
	truncate,
	truncateStart,
	visibleWidth,
	wrap,
	wrapItems,
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

describe("wrapItems", () => {
	it("lays the items two spaces apart", () => {
		expect(wrapItems(["laravel", "nuxt", "go"], 40)).toEqual([
			"laravel  nuxt  go",
		]);
	});

	it("breaks between items, never inside one that fits a line", () => {
		expect(wrapItems(["laravel", "nuxt-ui", "go"], 14)).toEqual([
			"laravel",
			"nuxt-ui  go",
		]);
	});

	it("wraps an item too long for a line of its own as prose, the next item after it", () => {
		expect(wrapItems(["a", "abcdefghij", "b"], 6)).toEqual([
			"a",
			"abcdef",
			"ghij",
			"b",
		]);
	});

	it("joins an item that fills the line exactly", () => {
		expect(wrapItems(["abc", "de"], 7)).toEqual(["abc  de"]);
	});

	it("wraps a first item too long for a line, leaving no empty line before it", () => {
		expect(wrapItems(["abcdefghij", "b"], 6)).toEqual(["abcdef", "ghij", "b"]);
	});

	it("gives no lines for no items", () => {
		expect(wrapItems([], 10)).toEqual([]);
	});
});

describe("fitAside", () => {
	it("keeps an aside whole where it fits", () => {
		expect(fitAside("skills/frontend", 15)).toBe("skills/frontend");
		expect(fitAside("ab", 2)).toBe("ab");
	});

	it("cuts one too long at its start, keeping the folder nearest the name", () => {
		expect(fitAside("skills/frontend", 14)).toBe("…ills/frontend");
		expect(fitAside("skills/frontend", 3)).toBe("…nd");
	});

	it("leaves it out only when fewer than three columns are left", () => {
		expect(fitAside("skills/frontend", 2)).toBe("");
		expect(fitAside("skills/frontend", 0)).toBe("");
	});
});

describe("wrap", () => {
	it("keeps a count with the noun after it, through a `more`", () => {
		expect(wrap("its 2 skills, 1 folder and 1 hook?", 16)).toEqual([
			"its 2 skills,",
			"1 folder and",
			"1 hook?",
		]);
		expect(wrap("… 11 more folders, 1 more agent", 22)).toEqual([
			"… 11 more folders,",
			"1 more agent",
		]);
		expect(wrap("a list of 3", 9)).toEqual(["a list of", "3"]);
	});

	it("keeps a `…` with the count it leads", () => {
		expect(wrap("… 33 more folders, 2 more", 20)).toEqual([
			"… 33 more folders,",
			"2 more",
		]);
	});

	it("breaks a count and its noun apart, between their words, when together they're wider than a line", () => {
		expect(wrap("… 33 more folders, 2 more", 15)).toEqual([
			"… 33 more",
			"folders, 2 more",
		]);
		expect(wrap("… 33 more folders, 2 more", 9)).toEqual([
			"… 33 more",
			"folders,",
			"2 more",
		]);
		expect(wrap("3 more skills already held by ex/kit", 6)).toEqual([
			"3 more",
			"skills",
			"alread",
			"y held",
			"by",
			"ex/kit",
		]);
	});

	it("keeps only a number as a count, never a word with a digit in it", () => {
		expect(wrap("go v2 now", 6)).toEqual(["go v2", "now"]);
		expect(wrap("go x1 now", 6)).toEqual(["go x1", "now"]);
		expect(wrap("tag 1.2.0 is out", 9)).toEqual(["tag 1.2.0", "is out"]);
	});

	it("cuts a word a character short rather than open the next line on a `,`", () => {
		expect(wrap("folders, 2 more", 7)).toEqual(["folder", "s,", "2 more"]);
	});

	it("never cuts a word that fits a line, nor leaves a line opening or ending on a space or opening on a `,`", () => {
		const texts = [
			"… 33 more folders, 2 more",
			"… 11 more folders, 1 more agent",
			"3 more skills already held by ex/kit",
			"pack · 12 skills, 3 folders, 1 agent and 1 hook",
			"Remove them and their 12 skills, 3 folders, 1 agent and 1 hook?",
			"14 skills already held by leeovery/agentic-skills/kit",
		];
		for (const text of texts) {
			const words = new Set(text.split(" "));
			const longest = Math.max(...[...words].map((word) => word.length));
			for (let width = 4; width <= 40; width++) {
				const lines = wrap(text, width);
				for (const line of lines) {
					expect(line).not.toMatch(/^ | $|^,/);
					if (width >= longest) {
						for (const word of line.split(" ")) {
							expect(words).toContain(word);
						}
					}
				}
			}
		}
	});

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

	it("breaks a long word after the last `/` that fits", () => {
		expect(wrap("owner/repo/a-long-skill", 15)).toEqual([
			"owner/repo/",
			"a-long-skill",
		]);
	});

	it("starts a word too long for a line of its own on the line it would join, up to the last `/` that fits there", () => {
		expect(wrap("see owner/repo/a-long-skill", 15)).toEqual([
			"see owner/repo/",
			"a-long-skill",
		]);
		expect(wrap("fatal: /aa/bbbb/cccccccc", 12)).toEqual([
			"fatal: /aa/",
			"bbbb/",
			"cccccccc",
		]);
	});

	it("starts such a word on a first line narrower than the rest too", () => {
		expect(wrap("ab/cdefghij", 10, 5)).toEqual(["ab/", "cdefghij"]);
	});

	it("moves a word that fits a line of its own there whole, and one with no `/` in reach of its line", () => {
		expect(wrap("see owner/repo/ski", 15)).toEqual(["see", "owner/repo/ski"]);
		expect(wrap("fatal: abcdefghijklmnop/q", 10)).toEqual([
			"fatal:",
			"abcdefghij",
			"klmnop/q",
		]);
		// The `/` a path opens with is no break.
		expect(wrap("fatal: /abcdefghijklmnop", 10)).toEqual([
			"fatal:",
			"/abcdefghi",
			"jklmnop",
		]);
	});

	it("never opens a line on a `/` its hard break would leave there, cutting a character sooner", () => {
		expect(wrap("abcdefgh/ij", 8)).toEqual(["abcdefg", "h/ij"]);
		expect(wrap("x abcdefgh/ijklmnopqr", 8)).toEqual([
			"x",
			"abcdefg",
			"h/",
			"ijklmnop",
			"qr",
		]);
	});

	it("looks for a `/` afresh on each line a break leaves", () => {
		expect(wrap(`aaaa/${"b".repeat(20)}`, 8)).toEqual([
			"aaaa/",
			"bbbbbbbb",
			"bbbbbbbb",
			"bbbb",
		]);
	});

	it("breaks after a `/` that is a word's second character", () => {
		expect(wrap("~/abcdefghij", 6)).toEqual(["~/", "abcdef", "ghij"]);
	});

	it("carries what follows a `/` when it and the overflowing character fill the next line exactly, wide ones included", () => {
		expect(wrap("a/bcd日", 5)).toEqual(["a/", "bcd日"]);
	});

	it("gives the line after a broken word its whole room, past a first line wider than the rest", () => {
		expect(wrap("abcdefghijklmnop qr", 4, 12)).toEqual([
			"abcdefghijkl",
			"mnop",
			"qr",
		]);
	});

	it("breaks hard where no `/` is in reach, and at a `/` again once one is", () => {
		expect(
			wrap("~/Code/agntc-sources/a-rather-long-local-folder-name/nuxt", 30),
		).toEqual([
			"~/Code/agntc-sources/",
			"a-rather-long-local-folder-nam",
			"e/nuxt",
		]);
		expect(wrap("abcdefghijkl/mn", 5)).toEqual(["abcde", "fghij", "kl/mn"]);
	});

	it("never breaks after a `/` that opens the line", () => {
		expect(wrap("/abcdefghij", 5)).toEqual(["/abcd", "efghi", "j"]);
	});

	it("breaks hard when what follows the `/` wouldn't fit the next line either", () => {
		expect(wrap("ab/cdefghijkl", 4, 12)).toEqual(["ab/cdefghijk", "l"]);
		// What follows fills the next line exactly, but the character that
		// overflowed would push it over.
		expect(wrap("ab/cdefg", 4, 7)).toEqual(["ab/cdef", "g"]);
	});

	it("lets a line open on a `/` rather than carry a wide character and the `/` past the width", () => {
		// The first line is wider than the rest, so 日 and the `/` after it
		// (3 columns) would overflow a line of 2.
		expect(wrap("abcdefghij日/x", 2, 12)).toEqual(["abcdefghij日", "/x"]);
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
