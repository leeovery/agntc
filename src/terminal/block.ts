import {
	indent,
	isNarrow,
	MARGIN,
	pad,
	roomFrom,
	truncate,
	truncateStart,
	visibleWidth,
	wrap,
	wrapItems,
} from "./layout.js";
import {
	createStyle,
	identity,
	type Painter,
	paintLines,
	type Style,
	statusGlyph,
	statusTone,
} from "./style.js";
import type {
	BlockSubject,
	Child,
	Detail,
	Field,
	Move,
	Noun,
	Progress,
	Row,
	Rows,
	Status,
} from "./types.js";

/** Where a block's columns sit, fixed from every row it will hold. */
export interface BlockLayout {
	subjectWidth: number;
	metaWidth: number;
	detailAt: number;
}

/** ` ✓ ` before a row's subject. */
const SUBJECT_AT = 3;
/** The column a child's branch, and the trunk running on below it, sit at. */
const BRANCH_AT = 3;
/** `   ├─ ` before a child's name. */
const CHILD_AT = 6;
/** A child's status glyph and its space, after the branch. */
const CHILD_GLYPH = 2;
/** How much further in a child one level deeper hangs: `│  ` before its branch. */
const LEVEL = 3;
const COLUMN_GAP = 3;
const MIN_GAP = 2;
const SUBJECT_SHARE = 0.45;
const META_SHARE = 0.2;
const MIN_META_COLUMN = 10;

/** Painters that paint nothing, for a line dimmed whole: dim can't nest in dim. */
const PLAIN = createStyle(0);

export function blockLayout(
	rows: readonly (Row | BlockSubject)[],
	width: number,
): BlockLayout {
	const subjectWidth = Math.min(
		widest(rows.flatMap(subjectMeasures)) + COLUMN_GAP,
		Math.floor(width * SUBJECT_SHARE),
	);
	const metaWidth = metaColumn(rows, width);
	return {
		subjectWidth,
		metaWidth,
		detailAt: SUBJECT_AT + subjectWidth + metaWidth,
	};
}

/**
 * The widest meta and 3, at most a fifth of the width (never under 10). A
 * meta too long for that is left out, so it moves its own row's detail down
 * rather than every row's; with none short enough the column is the cap.
 */
function metaColumn(rows: readonly BlockSubject[], width: number): number {
	const cap = Math.max(MIN_META_COLUMN, Math.floor(width * META_SHARE));
	const metas = rows.flatMap((row) =>
		row.meta ? [visibleWidth(row.meta) + COLUMN_GAP] : [],
	);
	if (metas.length === 0) {
		return 0;
	}
	const fitting = metas.filter((columns) => columns <= cap);
	return fitting.length === 0 ? cap : widest(fitting);
}

/** How far into the subject column a row's subject and each child's name reach. */
function subjectMeasures(row: BlockSubject): number[] {
	return [
		visibleWidth(row.subject),
		...(row.children ?? []).map(
			(child) => nameAt(child) - SUBJECT_AT + visibleWidth(child.name),
		),
	];
}

/** Where a child's name starts: past its branch, a level further in for each it hangs below, and past its glyph. */
function nameAt(child: Pick<Child, "status" | "depth">): number {
	return (
		CHILD_AT +
		LEVEL * depthOf(child) +
		(child.status === undefined ? 0 : CHILD_GLYPH)
	);
}

function depthOf(child: Pick<Child, "depth"> | undefined): number {
	return child?.depth ?? 0;
}

function widest(widths: readonly number[]): number {
	return Math.max(0, ...widths);
}

/** A row, its fields and its children, as lines no wider than `width - 1`. */
export function renderRow(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[] {
	return [
		...headLines(row, layout, width, style),
		...bodyUnits(row, layout, width, style).flat(),
	];
}

/**
 * The row in at most `room` lines: its head, as many of its fields and then
 * its children as fit whole, then a dim `… N more` line counting those left
 * out ({@link leftOut}), a child's when a child is the first of them; a
 * folder in a tree whose contents are all left out goes with them. Else its
 * one-line head ({@link shortHead}) and the count, as what it leaves out
 * outweighs its meta and detail; else its head alone; else its one-line head
 * alone, so a row with a line to itself always names its subject. Nothing in
 * no room.
 */
export function renderRowWithin(
	row: Row,
	room: number,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[] {
	const { head, units, more, keptEnd } = rowParts(row, layout, width, style);
	let used = head.length;
	let shown = 0;
	for (const [index, lines] of units.entries()) {
		const after = index === units.length - 1 ? [] : more(index + 1);
		if (used + lines.length + after.length > room) {
			break;
		}
		used += lines.length;
		shown += 1;
	}
	const short = [shortHead(row, width, style)];
	const count = units.length === 0 ? [] : more(0);
	const fitted =
		shown === units.length
			? [[...head, ...units.flat()]]
			: [[...head, ...units.slice(0, keptEnd(shown)).flat(), ...more(shown)]];
	return (
		[...fitted, [...short, ...count], head, short].find(
			(lines) => lines.length <= room,
		) ?? []
	);
}

/**
 * A row's head on one line, the last resort when its own lines don't fit:
 * its glyph and its subject, cut from the left with `…` as the header cuts a
 * folder, its meta and detail left out.
 */
function shortHead(row: Row, width: number, style: Style): string {
	const quiet = row.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const subject = truncateStart(row.subject, roomFrom(SUBJECT_AT, width));
	return dimWhole(
		quiet,
		style,
	)(`${MARGIN}${statusGlyph(row.status, paint)} ${paint.bold(subject)}`);
}

/**
 * The rows in at most `room` lines: as many as fit at their fewest
 * ({@link fewestLines}), then a dim `… N more` line at the rows' own level
 * counting any left out by their noun, the room to spare going to the rows in
 * turn, each fitted as {@link renderRowWithin} fits one, so rows that all fit
 * show whole. When not even the first fits at its fewest, the first as
 * {@link renderRowWithin} fits it beside the count of the rest; else the
 * first alone, as it fits. Nothing in no room.
 */
export function renderRowsWithin(
	{ rows, noun }: Rows,
	room: number,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[] {
	const [first] = rows;
	if (first === undefined) {
		return [];
	}
	if (rows.length === 1) {
		return renderRowWithin(first, room, layout, width, style);
	}
	const fewest = rows.map((row) =>
		fewestLines(rowParts(row, layout, width, style)),
	);
	const more = (shown: number) =>
		shown < rows.length
			? rowsLeftOut(rows.length - shown, noun, width, style)
			: [];
	const cost = (shown: number) =>
		total(fewest.slice(0, shown)) + more(shown).length;
	let shown = rows.length;
	while (shown > 0 && cost(shown) > room) {
		shown -= 1;
	}
	if (shown === 0) {
		const rest = more(1);
		const fitted = renderRowWithin(
			first,
			room - rest.length,
			layout,
			width,
			style,
		);
		return fitted.length === 0
			? renderRowWithin(first, room, layout, width, style)
			: [...fitted, ...rest];
	}
	let spare = room - cost(shown);
	const lines: string[] = [];
	for (const [index, row] of rows.slice(0, shown).entries()) {
		const least = fewest[index] ?? 0;
		const fitted = renderRowWithin(row, least + spare, layout, width, style);
		spare -= fitted.length - least;
		lines.push(...fitted);
	}
	return [...lines, ...more(shown)];
}

/** The rows a cut leaves out, counted at the rows' own level, `…` in their glyph's place. */
function rowsLeftOut(
	count: number,
	{ one, many }: Noun,
	width: number,
	style: Style,
): string[] {
	return leadLines(
		`${MARGIN}${style.dim("…")} `,
		SUBJECT_AT,
		`${count} more ${count === 1 ? one : many}`,
		style.dim,
		width,
	);
}

/**
 * A row as a room cuts it: its own lines, its body's units, the lines
 * counting those left out from one on, and where the units kept before a cut
 * there end.
 */
interface RowParts {
	head: string[];
	units: string[][];
	more: (from: number) => string[];
	keptEnd: (cut: number) => number;
}

function rowParts(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): RowParts {
	const units = bodyUnits(row, layout, width, style);
	const fields = row.fields ?? [];
	const children = row.children ?? [];
	const child = childPen(row, layout, width, style);
	const more = (from: number) => {
		const firstChild = Math.max(from - fields.length, 0);
		const text = leftOut(
			fields.slice(from),
			children.filter(
				(_, index) => index >= firstChild && isLeaf(children, index),
			),
		);
		return from < fields.length
			? countLines(text, FIELD_AT, width, style)
			: child({ name: text, dim: true }, CLOSING);
	};
	// A folder kept last has its contents cut, as what hangs below it comes next.
	const keptEnd = (cut: number) => {
		let end = cut;
		while (end > fields.length && !isLeaf(children, end - 1 - fields.length)) {
			end -= 1;
		}
		return end;
	};
	return { head: headLines(row, layout, width, style), units, more, keptEnd };
}

/** A dim count of what a cut leaves out, at `at`, wrapped in the room from there. */
function countLines(
	text: string,
	at: number,
	width: number,
	style: Style,
): string[] {
	return wrap(text, Math.max(1, roomFrom(at, width))).map(
		(line) => indent(at) + style.dim(line),
	);
}

/** Whether nothing hangs below a child: a folder in a tree isn't counted, what's in it is. */
function isLeaf(children: readonly Child[], index: number): boolean {
	return depthOf(children[index + 1]) <= depthOf(children[index]);
}

/** The fewest lines a row cut honestly takes: its own, and the lines counting its body when it has one. */
function fewestLines({ head, units, more }: RowParts): number {
	return head.length + (units.length === 0 ? 0 : more(0).length);
}

function total(counts: readonly number[]): number {
	return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * What a cut row leaves out, in words: a field of items or a child with a
 * noun by it, as `33 more folders`, those sharing a noun together; any other
 * field, and each other child, as one more.
 */
function leftOut(fields: readonly Field[], children: readonly Child[]): string {
	const items = new Map<string, number>();
	let others = 0;
	const add = (noun: string | undefined, count: number) => {
		if (noun === undefined) {
			others += 1;
		} else {
			items.set(noun, (items.get(noun) ?? 0) + count);
		}
	};
	for (const { value, noun } of fields) {
		add(typeof value === "string" ? undefined : noun, value.length);
	}
	for (const { noun } of children) {
		add(noun, 1);
	}
	const parts = [...items].map(
		([noun, count]) => `${count} more ${count === 1 ? noun : `${noun}s`}`,
	);
	return `… ${[...parts, ...(others > 0 ? [`${others} more`] : [])].join(", ")}`;
}

/** What hangs under a row's own lines, each whole: its fields' lines, then its children's. */
function bodyUnits(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[][] {
	const children = row.children ?? [];
	const child = childPen(row, layout, width, style);
	return [
		...fieldUnits(row, width, style),
		...children.map((each, index) => child(each, branchOf(children, index))),
	];
}

/**
 * Where a child hangs: whether the branch of each level above it runs on
 * past it, and whether it's the last of its siblings, closing its own.
 */
interface Branch {
	runs: readonly boolean[];
	last: boolean;
}

/** The last child at the row's own level, as a line counting those left out is. */
const CLOSING: Branch = { runs: [], last: true };

function branchOf(children: readonly Child[], index: number): Branch {
	const runs = Array.from({ length: depthOf(children[index]) }, (_, level) => {
		const parent = nearestAbove(children, index, level);
		return parent !== -1 && hasNextSibling(children, parent);
	});
	return { runs, last: !hasNextSibling(children, index) };
}

/** The nearest child before `index` hanging at `level`, or -1. */
function nearestAbove(
	children: readonly Child[],
	index: number,
	level: number,
): number {
	for (let at = index - 1; at >= 0; at--) {
		if (depthOf(children[at]) === level) {
			return at;
		}
	}
	return -1;
}

/** Whether a child further down hangs at the same level, before any hangs above it. */
function hasNextSibling(children: readonly Child[], index: number): boolean {
	const depth = depthOf(children[index]);
	const next = children
		.slice(index + 1)
		.find((child) => depthOf(child) <= depth);
	return next !== undefined && depthOf(next) === depth;
}

/** ` ✓ ` before a field's label, as before a row's subject. */
const FIELD_AT = SUBJECT_AT;

/**
 * Each of the row's fields as its lines: the label dim, in a column as wide
 * as the widest label and 2 (at most 45% of the width), the value beside it,
 * wrapped in the room that leaves. A row dim whole dims its fields too.
 */
function fieldUnits(row: Row, width: number, style: Style): string[][] {
	const fields = row.fields ?? [];
	const quiet = row.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const column = Math.min(
		widest(fields.map(({ label }) => visibleWidth(label))) + MIN_GAP,
		Math.floor(width * SUBJECT_SHARE),
	);
	const valueAt = FIELD_AT + column;
	const room = Math.max(1, roomFrom(valueAt, width));
	return fields.map(({ label, value, status }) => {
		const tone = status === undefined ? identity : statusTone(status, paint);
		const valueLines =
			typeof value === "string" ? wrap(value, room) : wrapItems(value, room);
		return flow(
			paintLines(wrap(label, Math.max(1, column - MIN_GAP)), paint.dim).map(
				(line) => (line === "" ? "" : indent(FIELD_AT) + line),
			),
			[{ at: valueAt, lines: paintLines(valueLines, tone) }],
		).map(dimWhole(quiet, style));
	});
}

/** A row's own lines, dim whole when it's unchanged. */
function headLines(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[] {
	const quiet = row.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	return rowLines(row, statusGlyph(row.status, paint), layout, {
		width,
		paint,
	}).map(dimWhole(quiet, style));
}

/** Draws one of the row's children on its branch. */
function childPen(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): (child: Child, branch: Branch) => string[] {
	const place = {
		detailAt: isNarrow(width) ? undefined : layout.detailAt,
		width,
		style,
	};
	return (child, branch) => renderChild(child, branch, row.status, place);
}

/**
 * A running step's one line, inside `width - 1`: the frame in the accent in
 * its glyph slot, its subject and meta in their columns, then what it's doing
 * dim in the detail column. Where that doesn't fit whole, or below 60
 * columns, each follows the one before two spaces on ({@link flowingProgress}).
 * Without a subject, what it's doing follows the frame, cut at its end;
 * without a layout, the subject is laid out alone.
 */
export function renderProgress(
	progress: Progress,
	frame: string,
	width: number,
	style: Style,
	layout?: BlockLayout,
): string {
	const glyph = style.accent(frame);
	const { subject, meta, text } = progress;
	if (subject === undefined) {
		return truncate(`${MARGIN}${glyph} ${style.dim(text)}`, width - 1);
	}
	const row: Row = { status: "note", subject, meta };
	const place = layout ?? blockLayout([row], width);
	const head = rowLines(row, glyph, place, { width, paint: style });
	const [lead = ""] = head;
	const columned =
		!isNarrow(width) &&
		head.length === 1 &&
		visibleWidth(lead) + MIN_GAP <= place.detailAt &&
		visibleWidth(text) <= roomFrom(place.detailAt, width);
	return columned
		? pad(lead, place.detailAt) + style.dim(text)
		: flowingProgress(glyph, subject, progress, width, style);
}

/** The fewest columns a subject cut to keep its meta beside it is left with. */
const MIN_CUT_SUBJECT = 12;

/**
 * The subject, its meta and what it's doing, each two spaces after the one
 * before, on one line. What it's doing keeps its width, or half the line
 * where that would cut the subject below {@link MIN_CUT_SUBJECT}; the subject
 * is cut from the left with `…` to leave it that, the meta left out first
 * where keeping it would cut the subject that far. Anything still too long is
 * cut at its end.
 */
function flowingProgress(
	glyph: string,
	subject: string,
	{ meta = "", text }: Progress,
	width: number,
	style: Style,
): string {
	const room = roomFrom(SUBJECT_AT, width);
	const subjectWidth = visibleWidth(subject);
	const least = Math.min(subjectWidth, MIN_CUT_SUBJECT);
	const textRoom = Math.min(
		visibleWidth(text),
		Math.max(Math.floor((room - MIN_GAP) / 2), room - MIN_GAP - least),
	);
	const left = room - MIN_GAP - textRoom;
	const metaPart = meta === "" ? 0 : MIN_GAP + visibleWidth(meta);
	const withMeta = metaPart > 0 && left - metaPart >= least;
	const shown = style.bold(
		truncateStart(subject, left - (withMeta ? metaPart : 0)),
	);
	const opening = withMeta
		? `${shown}${indent(MIN_GAP)}${style.dim(meta)}`
		: shown;
	const rest = roomFrom(SUBJECT_AT + visibleWidth(opening) + MIN_GAP, width);
	return `${MARGIN}${glyph} ${opening}${indent(MIN_GAP)}${style.dim(truncate(text, rest))}`;
}

interface Pen {
	width: number;
	paint: Style;
}

/** A row's own lines, opening with `glyph`; its children aside. */
function rowLines(
	row: Row,
	glyph: string,
	layout: BlockLayout,
	{ width, paint }: Pen,
): string[] {
	const lead = leadLines(
		`${MARGIN}${glyph} `,
		SUBJECT_AT,
		row.subject,
		paint.bold,
		width,
	);
	return isNarrow(width)
		? narrowRow(row, lead, width, paint)
		: wideRow(row, lead, layout, width, paint);
}

function wideRow(
	row: Row,
	lead: readonly string[],
	layout: BlockLayout,
	width: number,
	paint: Style,
): string[] {
	const metaAt = SUBJECT_AT + layout.subjectWidth;
	const room = roomFrom(layout.detailAt, width);
	return flow(lead, [
		{
			at: metaAt,
			lines: row.meta
				? paintLines(wrap(row.meta, roomFrom(metaAt, width)), paint.dim)
				: [],
		},
		{
			at: layout.detailAt,
			// Without a meta of its own, a row's subject must still end inside its column.
			bound: row.meta ? layout.detailAt : metaAt,
			lines: detailLines(
				row.detail,
				{ first: room, rest: room },
				row.status,
				paint,
			),
		},
	]);
}

/**
 * Below 60 columns the detail goes under the subject. The meta follows the
 * subject when it fits there, else it leads the detail.
 */
function narrowRow(
	row: Row,
	opening: readonly string[],
	width: number,
	paint: Style,
): string[] {
	const room = roomFrom(SUBJECT_AT, width);
	const lead = [...opening];
	const last = lead.at(-1) ?? "";
	const meta = row.meta ?? "";
	const followsSubject =
		meta !== "" &&
		visibleWidth(last) + MIN_GAP + visibleWidth(meta) <= width - 1;
	if (followsSubject) {
		lead[lead.length - 1] = `${last}${indent(MIN_GAP)}${paint.dim(meta)}`;
	}
	const metaLines =
		followsSubject || meta === ""
			? []
			: paintLines(wrap(meta, room), paint.dim);
	const metaEnd = metaLines.pop();
	const first =
		metaEnd === undefined ? room : room - visibleWidth(metaEnd) - MIN_GAP;
	const [detail = "", ...rest] = detailLines(
		row.detail,
		{ first, rest: room },
		row.status,
		paint,
	);
	const joined = [metaEnd ?? "", detail]
		.filter((part) => part !== "")
		.join(indent(MIN_GAP));
	return flow(lead, [
		{ at: SUBJECT_AT, lines: [...metaLines, joined, ...rest] },
	]);
}

/** `prefix`, then `text` wrapped to fit, continuing at `at`. */
function leadLines(
	prefix: string,
	at: number,
	text: string,
	paint: Painter,
	width: number,
): string[] {
	const [first = "", ...rest] = wrap(text, roomFrom(at, width));
	return [
		first === "" ? prefix.trimEnd() : prefix + paint(first),
		...rest.map((line) => indent(at) + paint(line)),
	];
}

interface Rooms {
	first: number;
	rest: number;
}

/** The one place a detail meets its room: every line it gives fits. */
function detailLines(
	detail: Detail | undefined,
	rooms: Rooms,
	status: Status,
	paint: Style,
): string[] {
	if (detail === undefined || detail === "") {
		return [];
	}
	if (typeof detail === "string") {
		return wrap(detail, rooms.rest, rooms.first);
	}
	const tone = statusTone(status, paint);
	if ("label" in detail) {
		const label = paintLines(wrap(detail.label, rooms.rest, rooms.first), tone);
		return detail.aside
			? runOn(label, `· ${detail.aside}`, rooms, paint.dim)
			: label;
	}
	return moveLines(detail.move, detail.note, rooms, tone, paint);
}

/** `lines`, then `text` running on from the last of them a space on, wrapping below. */
function runOn(
	lines: readonly string[],
	text: string,
	rooms: Rooms,
	paint: Painter,
): string[] {
	const last = lines.at(-1) ?? "";
	const used = last === "" ? 0 : visibleWidth(last) + 1;
	const lastRoom = lines.length <= 1 ? rooms.first : rooms.rest;
	const [first = "", ...rest] = wrap(text, rooms.rest, lastRoom - used);
	const ending =
		first === ""
			? [last]
			: [last === "" ? paint(first) : `${last} ${paint(first)}`];
	return [...lines.slice(0, -1), ...ending, ...paintLines(rest, paint)];
}

/**
 * `from →` dim then `to` bold, kept on one line where it fits. Its note
 * follows two spaces on, or wraps below it when there's no room.
 */
function moveLines(
	{ from, to }: Move,
	note: string | undefined,
	rooms: Rooms,
	tone: Painter,
	paint: Style,
): string[] {
	const moveWidth = visibleWidth(`${from} → ${to}`);
	const lines =
		moveWidth > rooms.rest
			? [
					...paintLines(wrap(`${from} →`, rooms.rest, rooms.first), paint.dim),
					...paintLines(wrap(to, rooms.rest), paint.bold),
				]
			: [
					...(moveWidth > rooms.first ? [""] : []),
					`${paint.dim(`${from} →`)} ${paint.bold(to)}`,
				];
	if (!note) {
		return lines;
	}
	const last = lines.at(-1) ?? "";
	const lastRoom = lines.length === 1 ? rooms.first : rooms.rest;
	if (visibleWidth(last) + MIN_GAP + visibleWidth(note) <= lastRoom) {
		return [...lines.slice(0, -1), `${last}${indent(MIN_GAP)}${tone(note)}`];
	}
	return [...lines, ...paintLines(wrap(note, rooms.rest), tone)];
}

interface ChildPlace {
	/** The detail column; below 60 columns, under the child's name. */
	detailAt?: number;
	width: number;
	style: Style;
}

function renderChild(
	child: Child,
	{ runs, last }: Branch,
	rowStatus: Status,
	{ detailAt, width, style }: ChildPlace,
): string[] {
	const quiet =
		rowStatus === "unchanged" ||
		child.status === "unchanged" ||
		child.dim === true;
	const paint = quiet ? PLAIN : style;
	const glyph =
		child.status === undefined ? "" : `${statusGlyph(child.status, paint)} `;
	const tone = isRead(child.status ?? rowStatus) ? identity : paint.dim;
	const name = nameAt(child);
	const at = detailAt ?? name;
	const rails = runs
		.map((on) => (on ? paint.dim("│") : " ") + indent(LEVEL - 1))
		.join("");
	const lines = flow(
		leadLines(
			`${indent(BRANCH_AT)}${rails}${paint.dim(last ? "└─" : "├─")} ${glyph}`,
			name,
			child.name,
			identity,
			width,
		),
		[
			{
				at,
				lines: child.detail
					? paintLines(wrap(child.detail, roomFrom(at, width)), tone)
					: [],
			},
		],
	);
	// The branches running on past this child's lines, its own with a sibling
	// below, overwrite spaces: those lines all open with spaces to its name.
	const trunk = `${indent(BRANCH_AT)}${rails}${last ? " " : paint.dim("│")}`;
	const trunkWidth = BRANCH_AT + LEVEL * runs.length + 1;
	return lines
		.map((line, index) => (index === 0 ? line : trunk + line.slice(trunkWidth)))
		.map(dimWhole(quiet, style));
}

/** A failure's or a warning's reason is read, so it stays normal; the rest is quiet. */
function isRead(status: Status): boolean {
	return status === "failed" || status === "attention";
}

interface Cell {
	at: number;
	/** The column what's before the cell must end two short of, to share its line; `at` unless given. */
	bound?: number;
	/** Each fits from `at`; an empty first line means the cell starts below. */
	lines: readonly string[];
}

/** `lead`, then each cell at its column: on the line so far when it fits, else on a line of its own. */
function flow(lead: readonly string[], cells: readonly Cell[]): string[] {
	const lines = [...lead];
	for (const { at, bound = at, lines: cellLines } of cells) {
		const [first, ...rest] = cellLines;
		if (first === undefined) {
			continue;
		}
		const current = lines.at(-1) ?? "";
		const shares = first !== "" && visibleWidth(current) + MIN_GAP <= bound;
		if (shares) {
			lines[lines.length - 1] = pad(current, at) + first;
		}
		const below = shares || first === "" ? rest : [first, ...rest];
		lines.push(...below.map((line) => indent(at) + line));
	}
	return lines;
}

function dimWhole(quiet: boolean, style: Style): (line: string) => string {
	return (line) =>
		quiet ? MARGIN + style.dim(line.slice(MARGIN.length)) : line;
}
