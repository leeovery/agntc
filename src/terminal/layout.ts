import { identity, type Painter } from "./style.js";

const MAX_WIDTH = 100;
const MIN_WIDTH = 20;
const DEFAULT_COLUMNS = 80;
const NARROW_BELOW = 60;

/** The one-space margin every line opens with; nothing is drawn in the last column either. */
export const MARGIN = " ";

/** The terminal's width, at most 100 and at least 20; 80 when it gives none, or 0 as some ptys do. */
export function layoutWidth(columns?: number): number {
	return Math.max(MIN_WIDTH, Math.min(columns || DEFAULT_COLUMNS, MAX_WIDTH));
}

export function isNarrow(width: number): boolean {
	return width < NARROW_BELOW;
}

/** The columns left for text starting at `column`, inside the right margin. */
export function roomFrom(column: number, width: number): number {
	return width - 1 - column;
}

export function indent(columns: number): string {
	return " ".repeat(Math.max(0, columns));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR escape codes open with ESC
const SGR = /\x1b\[[0-9;]*m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR escape codes open with ESC
const SGR_PIECE = /(\x1b\[[0-9;]*m)/;

type Range = readonly [number, number];

// East Asian Wide and Fullwidth, and characters with emoji presentation.
const WIDE: readonly Range[] = [
	[0x1100, 0x115f],
	[0x231a, 0x231b],
	[0x2329, 0x232a],
	[0x23e9, 0x23ec],
	[0x23f0, 0x23f0],
	[0x23f3, 0x23f3],
	[0x25fd, 0x25fe],
	[0x2614, 0x2615],
	[0x2648, 0x2653],
	[0x267f, 0x267f],
	[0x2693, 0x2693],
	[0x26a1, 0x26a1],
	[0x26aa, 0x26ab],
	[0x26bd, 0x26be],
	[0x26c4, 0x26c5],
	[0x26ce, 0x26ce],
	[0x26d4, 0x26d4],
	[0x26ea, 0x26ea],
	[0x26f2, 0x26f3],
	[0x26f5, 0x26f5],
	[0x26fa, 0x26fa],
	[0x26fd, 0x26fd],
	[0x2705, 0x2705],
	[0x270a, 0x270b],
	[0x2728, 0x2728],
	[0x274c, 0x274c],
	[0x274e, 0x274e],
	[0x2753, 0x2755],
	[0x2757, 0x2757],
	[0x2795, 0x2797],
	[0x27b0, 0x27b0],
	[0x27bf, 0x27bf],
	[0x2b1b, 0x2b1c],
	[0x2b50, 0x2b50],
	[0x2b55, 0x2b55],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xa960, 0xa97f],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe10, 0xfe19],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x16fe0, 0x16fe4],
	[0x17000, 0x18aff],
	[0x1b000, 0x1b2ff],
	[0x1f004, 0x1f004],
	[0x1f0cf, 0x1f0cf],
	[0x1f18e, 0x1f18e],
	[0x1f191, 0x1f19a],
	[0x1f200, 0x1f2ff],
	[0x1f300, 0x1f3fa],
	[0x1f400, 0x1f64f],
	[0x1f680, 0x1f6ff],
	[0x1f7e0, 0x1f7eb],
	[0x1f90c, 0x1f9ff],
	[0x1fa70, 0x1faff],
	[0x20000, 0x2fffd],
	[0x30000, 0x3fffd],
];

function inRanges(code: number, ranges: readonly Range[]): boolean {
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const [start, end] = ranges[middle] as Range;
		if (code < start) {
			high = middle - 1;
		} else if (code > end) {
			low = middle + 1;
		} else {
			return true;
		}
	}
	return false;
}

const graphemes = new Intl.Segmenter();
// Printable ASCII is one column a character, so it skips the segmenter.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// Marks and format characters draw on the character before them, as an
// emoji's skin tone does on the emoji.
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}\p{Cc}\p{Emoji_Modifier}]/u;
// An emoji joined to others (ZWJ) or asked to draw as one (VS16) takes two.
const EMOJI_SEQUENCE = /^\p{Emoji}.*[\u200d\ufe0f]/su;

function clusterWidth(cluster: string): number {
	if (PRINTABLE_ASCII.test(cluster)) {
		return cluster.length;
	}
	if (EMOJI_SEQUENCE.test(cluster)) {
		return 2;
	}
	let width = 0;
	for (const char of cluster) {
		if (!ZERO_WIDTH.test(char)) {
			width += inRanges(char.codePointAt(0) ?? 0, WIDE) ? 2 : 1;
		}
	}
	return width;
}

function clustersOf(text: string): string[] {
	return PRINTABLE_ASCII.test(text)
		? text.split("")
		: [...graphemes.segment(text)].map(({ segment }) => segment);
}

/** The text's escape codes and grapheme clusters, in order. */
function pieces(text: string): string[] {
	return text
		.split(SGR_PIECE)
		.flatMap((part, index) => (index % 2 === 1 ? [part] : clustersOf(part)));
}

function isSgr(piece: string): boolean {
	return piece.startsWith("\x1b[");
}

/** Columns the text takes on screen, escape codes aside. */
export function visibleWidth(text: string): number {
	const plain = text.replace(SGR, "");
	if (PRINTABLE_ASCII.test(plain)) {
		return plain.length;
	}
	let width = 0;
	for (const cluster of clustersOf(plain)) {
		width += clusterWidth(cluster);
	}
	return width;
}

export function pad(text: string, width: number): string {
	return text + indent(Math.max(0, width - visibleWidth(text)));
}

export function padStart(text: string, width: number): string {
	return indent(Math.max(0, width - visibleWidth(text))) + text;
}

/** The longest run of plain `clusters` that fits in `width` columns. */
function fitting(clusters: readonly string[], width: number): string[] {
	const kept: string[] = [];
	let used = 0;
	for (const cluster of clusters) {
		used += clusterWidth(cluster);
		if (used > width) {
			break;
		}
		kept.push(cluster);
	}
	return kept;
}

/**
 * Text cut at the end to fit `width`, marked with `…`. Every escape code
 * stays, those past the cut included, so what they open they also close.
 */
export function truncate(text: string, width: number): string {
	if (visibleWidth(text) <= width) {
		return text;
	}
	let room = width - 1;
	let cut = false;
	let kept = "";
	for (const piece of pieces(text)) {
		const columns = isSgr(piece) ? 0 : clusterWidth(piece);
		if (isSgr(piece) || (!cut && columns <= room)) {
			kept += piece;
			room -= columns;
		} else {
			cut = true;
		}
	}
	return width < 1 ? kept : `${kept}…`;
}

/** Between an aside and the hint or detail it leads. */
export const ASIDE_JOIN = " · ";
/** The fewest columns an aside is shown in: its `…` and two of its own. */
const MIN_ASIDE = 3;

/**
 * An aside inside `room`: whole where it fits, else cut at its start, so the
 * folder nearest the name stays; empty only when fewer than three columns
 * are left for it.
 */
export function fitAside(aside: string, room: number): string {
	const fits = visibleWidth(aside) <= room;
	return fits || room >= MIN_ASIDE ? truncateStart(aside, room) : "";
}

/** Plain text cut at the start to fit `width`, marked with `…`. */
export function truncateStart(text: string, width: number): string {
	if (visibleWidth(text) <= width) {
		return text;
	}
	if (width < 1) {
		return "";
	}
	return `…${fitting(clustersOf(text).reverse(), width - 1)
		.reverse()
		.join("")}`;
}

/** `left`, then `right` ending at the right margin, or undefined without a gap of two. */
export function spread(
	left: string,
	right: string,
	width: number,
): string | undefined {
	const gap = width - 1 - visibleWidth(left) - visibleWidth(right);
	return gap < 2 ? undefined : left + indent(gap) + right;
}

/** Prose wrapped to fit from `column`, each line indented to it; nothing for empty text. */
export function prose(
	text: string,
	column: number,
	width: number,
	paint: Painter = identity,
): string[] {
	return text === ""
		? []
		: wrap(text, roomFrom(column, width)).map(
				(line) => indent(column) + paint(line),
			);
}

/**
 * Plain prose wrapped at spaces into lines of `width` columns, the first line
 * `firstWidth`. A word too long for the line it would join
 * starts the next, leaving the first empty when it's the first word; a word
 * longer than `width` is broken, starting on the line it would join when a
 * `/` past its first character ends a part of it that fits there, so no line
 * is left holding the word before a path alone.
 */
export function wrap(
	text: string,
	width: number,
	firstWidth = width,
): string[] {
	return text
		.split("\n")
		.flatMap((paragraph, index) =>
			wrapParagraph(paragraph, width, index === 0 ? firstWidth : width),
		);
}

const ITEM_GAP = "  ";

/**
 * Items two spaces apart, in lines of `width` columns broken between them;
 * an item too long for a line of its own wraps as prose does.
 */
export function wrapItems(items: readonly string[], width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const item of items) {
		const joined = line === "" ? item : `${line}${ITEM_GAP}${item}`;
		if (visibleWidth(joined) <= width) {
			line = joined;
			continue;
		}
		if (line !== "") {
			lines.push(line);
		}
		const pieces = wrap(item, width);
		line = pieces.pop() ?? "";
		lines.push(...pieces);
	}
	return line === "" ? lines : [...lines, line];
}

function wrapParagraph(
	text: string,
	width: number,
	firstWidth: number,
): string[] {
	const full = Math.max(1, width);
	const lines: string[] = [];
	let line = "";
	let room = firstWidth;
	const join = (part: string) => (line === "" ? part : `${line} ${part}`);
	const breakLine = () => {
		lines.push(line);
		line = "";
		room = full;
	};

	for (const word of unitsOf(text, full)) {
		const wordWidth = visibleWidth(word);
		const used = line === "" ? 0 : visibleWidth(line) + 1;
		if (used + wordWidth <= room) {
			line = join(word);
			continue;
		}
		// Short of a whole line, a word too long for one starts here when part of
		// it ends on a `/` that fits; on a whole one, breakWord decides alone.
		const short = line !== "" || room < full;
		const head =
			short && wordWidth > full ? slashHead(word, room - used) : undefined;
		if (head !== undefined) {
			line = join(head);
		}
		if (short) {
			breakLine();
		}
		const pieces = breakWord(word.slice(head?.length ?? 0), room, full);
		line = pieces.pop() ?? "";
		lines.push(...pieces);
		// A first line wider than the rest isn't broken above, so its room
		// still holds when the word is: the word's last piece sits on a full one.
		if (pieces.length > 0) {
			room = full;
		}
	}
	lines.push(line);
	return lines;
}

/**
 * What a line breaks between: its words, but a count stays with the noun
 * after it, through a `more` between them, and a `…` with what it leads, so
 * neither `1 hook` nor `… 3 more skills` splits across lines. A unit wider
 * than `full` breaks between its words instead, so no word in it is cut.
 */
function unitsOf(text: string, full: number): string[] {
	const units: string[][] = [];
	let unit: string[] = [];
	for (const word of text.split(" ").filter((each) => each !== "")) {
		unit.push(word);
		if (!leads(word, unit)) {
			units.push(unit);
			unit = [];
		}
	}
	if (unit.length > 0) {
		units.push(unit);
	}
	return units.flatMap((words) => {
		const joined = words.join(" ");
		return visibleWidth(joined) <= full ? [joined] : words;
	});
}

/** Whether `word`, last in `unit`, holds on to the word after it. */
function leads(word: string, unit: readonly string[]): boolean {
	const before = unit.at(-2);
	return (
		word === "…" ||
		COUNT.test(word) ||
		(word === "more" && before !== undefined && COUNT.test(before))
	);
}

const COUNT = /^\d+$/;

/**
 * The longest start of `word` that ends on a `/` past its first character
 * and fits in `room` columns; undefined when none does.
 */
function slashHead(word: string, room: number): string | undefined {
	let head: string | undefined;
	let taken = "";
	let used = 0;
	for (const [index, cluster] of clustersOf(word).entries()) {
		used += clusterWidth(cluster);
		if (used > room) {
			break;
		}
		taken += cluster;
		if (cluster === "/" && index > 0) {
			head = taken;
		}
	}
	return head;
}

/**
 * A word in lines of `rest` columns, the first `first`. A line it overflows
 * ends after its last `/` past its first character, when what follows the
 * `/` fits the next line; else where its room runs out, but a character
 * short where that would open the next line on a `/`.
 */
function breakWord(word: string, first: number, rest: number): string[] {
	const lines: string[] = [];
	let line: string[] = [];
	let used = 0;
	let room = first;
	let slash = 0;
	for (const cluster of clustersOf(word)) {
		const columns = clusterWidth(cluster);
		if (line.length > 0 && used + columns > room) {
			const cut = cutAt(line, slash, cluster, rest);
			lines.push(line.slice(0, cut).join(""));
			line = line.slice(cut);
			used = columnsOf(line);
			slash = 0;
			room = rest;
		}
		line.push(cluster);
		used += columns;
		if (cluster === "/" && line.length > 1) {
			slash = line.length;
		}
	}
	lines.push(line.join(""));
	return lines;
}

/**
 * Where a line `next` overflows is cut: after its last `/` (at `slash`) when
 * what follows it and `next` fit `rest`; else before `next`, or a character
 * sooner when `next` is a `/` or a `,`, so the line after doesn't open on it.
 */
function cutAt(
	line: readonly string[],
	slash: number,
	next: string,
	rest: number,
): number {
	const fits = (from: number) =>
		columnsOf(line.slice(from)) + clusterWidth(next) <= rest;
	if (slash > 0 && fits(slash)) {
		return slash;
	}
	const sooner = line.length - 1;
	return (next === "/" || next === ",") && sooner > 0 && fits(sooner)
		? sooner
		: line.length;
}

function columnsOf(clusters: readonly string[]): number {
	return clusters.reduce((sum, cluster) => sum + clusterWidth(cluster), 0);
}
