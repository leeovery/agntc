import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import {
	blockLayout,
	renderProgress,
	renderRow,
	renderRowsWithin,
	renderRowWithin,
} from "../../src/terminal/block.js";
import { wrap } from "../../src/terminal/layout.js";
import { createStyle } from "../../src/terminal/style.js";
import type {
	Child,
	Detail,
	Field,
	Row,
	Status,
} from "../../src/terminal/types.js";

// Generated rows, cut to every room at the widths the layout changes at:
// whatever a cut keeps, no line reaches the last column, so the terminal never
// wraps one and a frame takes exactly the lines the fit counted (measured by
// string-width, not by the module's own visibleWidth). And it's honest: the
// first row's subject is always named, a cut row keeps its count once it can,
// and every row is shown or counted.

/** A small seeded generator (mulberry32), so a failure replays. */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"a",
	"nuxt",
	"leeovery/agentic-skills",
	"/Users/someone/code/a-very-long-folder-name/with/more/of/it",
	"x".repeat(70),
	"日本語のスキル",
	"already installed as part of the pack",
];
const FIELD_NOUNS = ["folder", "agent", "hook", undefined];
const STATUSES: Status[] = [
	"done",
	"unchanged",
	"attention",
	"failed",
	"subject",
	"note",
	"local",
];

function generator(seed: number) {
	const next = random(seed);
	const pick = <T>(items: readonly T[]): T =>
		items[Math.floor(next() * items.length)] as T;
	const count = (most: number) => Math.floor(next() * (most + 1));
	const words = () =>
		Array.from({ length: 1 + count(3) }, () => pick(WORDS)).join(" ");
	const field = (): Field => {
		const noun = pick(FIELD_NOUNS);
		return {
			label: pick([
				".claude/skills/",
				".claude/agents/",
				".claude/hooks/",
				".agents/skills/",
			]),
			value:
				noun === undefined && next() < 0.5
					? words()
					: Array.from({ length: 1 + count(12) }, () => pick(WORDS)),
			...(noun === undefined ? {} : { noun }),
		};
	};
	const children = (): Child[] => {
		let depth = 0;
		return Array.from({ length: count(12) }, () => {
			depth = Math.max(0, Math.min(4, depth + pick([-1, 0, 0, 1])));
			return {
				name: words(),
				...(next() < 0.5 ? { aside: words() } : {}),
				...(next() < 0.5 ? { detail: words() } : {}),
				...(next() < 0.3 ? { status: pick(STATUSES) } : {}),
				...(next() < 0.3 ? { noun: pick(["file", "skill"]) } : {}),
				depth,
			};
		});
	};
	const detail = (): Detail =>
		pick([
			() => words(),
			() => ({ label: words(), aside: words() }),
			() => ({
				move: { from: words(), to: words() },
				...(next() < 0.5 ? { note: words() } : {}),
			}),
		])();
	const row = (): Row => ({
		status: pick(STATUSES),
		subject: words(),
		...(next() < 0.5 ? { meta: words() } : {}),
		...(next() < 0.8 ? { detail: detail() } : {}),
		fields: Array.from({ length: count(4) }, field),
		children: children(),
	});
	return { row, count };
}

/** The widths the layout changes at: the narrowest, either side of 40, 60 and 80, and the widest. */
const WIDTHS = [
	...Array.from({ length: 11 }, (_, index) => 20 + index),
	39,
	40,
	41,
	59,
	60,
	61,
	79,
	80,
	81,
	99,
	100,
];
const ROOMS = Array.from({ length: 40 }, (_, index) => 1 + index);
const SEEDS = [1, 2, 3];
const ENTRY = { one: "entry", many: "entries" };
/** A noun long enough that the count of rows left out wraps at the narrowest widths. */
const LONG_NOUN = {
	one: "entry asked about here",
	many: "entries asked about here",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape codes
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (line: string) => line.replace(SGR, "");
/** A cut row's count of what it leaves out, as its first line opens it. */
const COUNT = /… \d+ more/;
/** The count of rows left out, at the rows' own level. */
const ROWS_LEFT_OUT = /^ … (\d+) more /;

/**
 * Whether the line opens with a row's glyph and its subject: the subject's
 * first wrapped line, or its tail cut from the left on one line.
 */
function names(line: string, subject: string): boolean {
	const [shown = ""] = plain(line).slice(3).split("  ");
	return (
		shown !== "" &&
		(subject.startsWith(shown) ||
			(shown.startsWith("…") && subject.endsWith(shown.slice(1))))
	);
}

/** The rows the lines show by a head, a glyph at the margin, and those they count as left out. */
function accounted(lines: readonly string[]): number {
	return lines.reduce((sum, line) => {
		const text = plain(line);
		const left = ROWS_LEFT_OUT.exec(text);
		if (left !== null) {
			return sum + Number(left[1]);
		}
		return sum + (text[1] === undefined || text[1] === " " ? 0 : 1);
	}, 0);
}

const counts = (lines: readonly string[]) =>
	lines.some((line) => COUNT.test(plain(line)));

describe("a row cut to its room", () => {
	// Every line under width - 1 is drawn on one line of the terminal, so the
	// lines returned are the frame's lines, and the room bounds those too.
	it.each(
		WIDTHS,
	)("fits every line and its room at %i columns, honestly", (width) => {
		const problems: string[] = [];
		for (const seed of SEEDS) {
			const style = createStyle(seed % 2 === 0 ? 0 : 3);
			const { row, count } = generator(seed);
			const rows = Array.from({ length: 2 + count(3) }, row);
			const [first] = rows as [Row, ...Row[]];
			const layout = blockLayout(rows, width);
			const whole = renderRow(first, layout, width, style).join("\n");
			let counted = false;
			let allBefore = false;
			let before = 0;
			for (const room of ROOMS) {
				const at = (name: string) => `seed ${seed}, ${name}, room ${room}`;
				const lone = renderRowWithin(first, room, layout, width, style);
				const several = renderRowsWithin(
					{ rows, noun: seed === 3 ? LONG_NOUN : ENTRY },
					room,
					layout,
					width,
					style,
				);
				for (const [name, lines] of [
					["row", lone],
					["rows", several],
				] as const) {
					if (lines.length > room) {
						problems.push(`${at(name)}: ${lines.length} lines`);
					}
					for (const line of lines.filter(
						(each) => stringWidth(each) > width - 1,
					)) {
						problems.push(`${at(name)}: ${JSON.stringify(line)}`);
					}
					if (!names(lines[0] ?? "", first.subject)) {
						problems.push(`${at(name)}: doesn't name its subject`);
					}
				}
				// Once a cut row can keep the count of what it leaves out, it
				// always does, and more room never shows less of it.
				counted ||= counts(lone);
				if (counted && lone.join("\n") !== whole && !counts(lone)) {
					problems.push(`${at("row")}: drops its count`);
				}
				if (lone.length < before) {
					problems.push(`${at("row")}: ${lone.length} lines after ${before}`);
				}
				before = lone.length;
				// Each row shown by its head or counted once the count fits beside
				// the first's one line, as it does in 3 (a count takes 2 at most
				// here), and ever after.
				const all = accounted(several) === rows.length;
				if (!all && (allBefore || room >= 3)) {
					problems.push(
						`${at("rows")}: accounts for ${accounted(several)} of ${rows.length}`,
					);
				}
				allBefore ||= all;
			}
		}
		expect(problems.slice(0, 10)).toEqual([]);
	});
});

describe("a child's aside", () => {
	const withoutAsides = (row: Row): Row => ({
		...row,
		...(row.children === undefined
			? {}
			: {
					children: row.children.map(({ aside: _, ...child }) => child),
				}),
	});

	it.each(
		WIDTHS,
	)("never widens a column at %i columns, nor moves a name", (width) => {
		const problems: string[] = [];
		for (const seed of SEEDS) {
			const { row, count } = generator(seed);
			const rows = Array.from({ length: 2 + count(3) }, row);
			const bare = rows.map(withoutAsides);
			const layout = blockLayout(rows, width);
			if (JSON.stringify(layout) !== JSON.stringify(blockLayout(bare, width))) {
				problems.push(`seed ${seed}: its layout moves`);
			}
			const [first, firstBare] = [rows[0], bare[0]] as [Row, Row];
			const shown = renderRow(first, layout, width, createStyle(0));
			if (shown[0] !== renderRow(firstBare, layout, width, createStyle(0))[0]) {
				problems.push(`seed ${seed}: its head moves`);
			}
		}
		expect(problems.slice(0, 10)).toEqual([]);
	});
});

describe("a running step's line", () => {
	// Whatever its subject, meta and text, a progress line is one line inside
	// the width, opening with its subject or the subject's tail cut from the
	// left, and its text shows: whole, or at least half the line's room.
	it.each(
		WIDTHS,
	)("is one line inside the width at %i columns, its text shown", (width) => {
		const problems: string[] = [];
		for (const seed of SEEDS) {
			const style = createStyle(seed % 2 === 0 ? 0 : 3);
			const { row } = generator(seed);
			const rows = Array.from({ length: 6 }, row);
			const layout = blockLayout(rows, width);
			for (const [index, { subject, meta }] of rows.entries()) {
				const text = WORDS[index % WORDS.length] as string;
				const line = renderProgress(
					{ subject, ...(meta === undefined ? {} : { meta }), text },
					"⠁",
					width,
					style,
					layout,
				);
				const at = `seed ${seed}, row ${index}`;
				if (line.includes("\n") || stringWidth(line) > width - 1) {
					problems.push(`${at}: ${JSON.stringify(line)}`);
				}
				const shown = plain(line).slice(3);
				const [opening = ""] = shown.split("  ");
				const named =
					opening === subject ||
					(opening.startsWith("…") && subject.endsWith(opening.slice(1)));
				if (!named) {
					problems.push(`${at}: opens with ${JSON.stringify(opening)}`);
				}
				const textShown = shown.slice(shown.lastIndexOf("  ") + 2);
				// A wide character never splits, so a cut can fall a column short.
				const half = Math.floor((width - 6) / 2) - 1;
				if (
					textShown !== text &&
					stringWidth(textShown) < Math.min(half, stringWidth(text))
				) {
					problems.push(`${at}: its text gets ${stringWidth(textShown)}`);
				}
			}
		}
		expect(problems.slice(0, 10)).toEqual([]);
	});
});

describe("a long path wrapped", () => {
	// A path broken across lines breaks after a `/` wherever one past a line's
	// first character is in reach, and its lines rejoin to the path.
	const PATHS = [
		"/Users/someone/code/a-very-long-folder-name/with/more/of/it",
		"~/Code/agntc-sources/a-rather-long-local-source-folder-name/with-another-level/pack-1",
		"leeovery/a-very-long-repository-name-for-skills/skills/nuxt",
		`${"x".repeat(70)}/tail`,
		"日本語のスキル/日本語のスキル/日本語のスキル/日本語",
	];

	it.each(WIDTHS)("breaks after a `/` in reach at %i columns", (width) => {
		const room = width - 4;
		const problems: string[] = [];
		for (const path of PATHS) {
			const lines = wrap(path, room);
			if (lines.join("") !== path) {
				problems.push(`${path}: rejoins as ${lines.join("")}`);
			}
			for (const [index, line] of lines.entries()) {
				if (stringWidth(line) > room) {
					problems.push(`${path}: ${JSON.stringify(line)} overflows`);
				}
				const last = index === lines.length - 1;
				if (!last && !line.endsWith("/") && line.slice(1).includes("/")) {
					problems.push(`${path}: ${JSON.stringify(line)} passes a /`);
				}
			}
		}
		expect(problems).toEqual([]);
	});
});
