import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import {
	blockLayout,
	renderRowsWithin,
	renderRowWithin,
} from "../../src/terminal/block.js";
import { createStyle } from "../../src/terminal/style.js";
import type {
	Child,
	Detail,
	Field,
	Row,
	Status,
} from "../../src/terminal/types.js";

// Generated rows, cut to every room at every width: whatever a cut keeps, no
// line reaches the last column, so the terminal never wraps one and a frame
// takes exactly the lines the fit counted. Measured by string-width, not by
// the module's own visibleWidth.

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

const WIDTHS = Array.from({ length: 81 }, (_, index) => 20 + index);
const ROOMS = Array.from({ length: 40 }, (_, index) => 1 + index);
const SEEDS = [1, 2, 3];
const ENTRY = { one: "entry", many: "entries" };

/**
 * Every width, each with its seeds' rows cut to a third of the rooms, a
 * different third for each seed, and in colour at every other width: every
 * room and both colour levels are reached at every width's neighbours, in a
 * few seconds rather than a minute.
 */
function cases(width: number) {
	const style = createStyle(width % 2 === 0 ? 0 : 3);
	return SEEDS.flatMap((seed) => {
		const { row, count } = generator(seed);
		const rows = Array.from({ length: 1 + count(4) }, row);
		return ROOMS.filter((room) => (room + width + seed) % 3 === 0).map(
			(room) => ({ seed, rows, room, style }),
		);
	});
}

describe("a row cut to its room", () => {
	// Every line under width - 1 is drawn on one line of the terminal, so the
	// lines returned are the frame's lines, and the room bounds those too.
	it.each(WIDTHS)("fits every line and its room at %i columns", (width) => {
		const problems: string[] = [];
		for (const { seed, rows, room, style } of cases(width)) {
			const layout = blockLayout(rows, width);
			const fitted = {
				row: renderRowWithin(rows[0] as Row, room, layout, width, style),
				rows: renderRowsWithin(
					{ rows, noun: ENTRY },
					room,
					layout,
					width,
					style,
				),
			};
			for (const [name, lines] of Object.entries(fitted)) {
				const at = `seed ${seed}, ${name}, room ${room}`;
				if (lines.length > room) {
					problems.push(`${at}: ${lines.length} lines`);
				}
				for (const line of lines.filter(
					(each) => stringWidth(each) > width - 1,
				)) {
					problems.push(`${at}: ${JSON.stringify(line)}`);
				}
			}
		}
		expect(problems.slice(0, 10)).toEqual([]);
	});
});
