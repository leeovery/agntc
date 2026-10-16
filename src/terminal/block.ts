import {
	indent,
	isNarrow,
	MARGIN,
	pad,
	roomFrom,
	truncate,
	visibleWidth,
	wrap,
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
	Move,
	Progress,
	Row,
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
			(child) =>
				CHILD_AT -
				SUBJECT_AT +
				(child.status === undefined ? 0 : CHILD_GLYPH) +
				visibleWidth(child.name),
		),
	];
}

function widest(widths: readonly number[]): number {
	return Math.max(0, ...widths);
}

/** A row and its children, as lines no wider than `width - 1`. */
export function renderRow(
	row: Row,
	layout: BlockLayout,
	width: number,
	style: Style,
): string[] {
	const quiet = row.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const lines = rowLines(row, statusGlyph(row.status, paint), layout, {
		width,
		paint,
	});
	const children = row.children ?? [];
	return [
		...lines.map(dimWhole(quiet, style)),
		...children.flatMap((child, index) =>
			renderChild(child, index === children.length - 1, row.status, {
				detailAt: isNarrow(width) ? undefined : layout.detailAt,
				width,
				style,
			}),
		),
	];
}

/**
 * A running step's one line, cut to `width - 1`: the frame in the accent in
 * its glyph slot, its subject and meta in their columns, then what it's doing
 * dim in the detail column, or two spaces after them where they reach it or
 * below 60 columns. Without a subject, what it's doing follows the frame;
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
	const text = style.dim(progress.text);
	const { subject, meta } = progress;
	if (subject === undefined) {
		return truncate(`${MARGIN}${glyph} ${text}`, width - 1);
	}
	const row: Row = { status: "note", subject, meta };
	const place = layout ?? blockLayout([row], width);
	const [lead = ""] = rowLines(row, glyph, place, { width, paint: style });
	const follows = visibleWidth(lead) + MIN_GAP;
	const at =
		isNarrow(width) || follows > place.detailAt ? follows : place.detailAt;
	return truncate(pad(lead, at) + text, width - 1);
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
	last: boolean,
	rowStatus: Status,
	{ detailAt, width, style }: ChildPlace,
): string[] {
	const quiet = rowStatus === "unchanged" || child.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const glyph =
		child.status === undefined ? "" : `${statusGlyph(child.status, paint)} `;
	const tone = isRead(child.status ?? rowStatus) ? identity : paint.dim;
	const nameAt = CHILD_AT + (child.status === undefined ? 0 : CHILD_GLYPH);
	const at = detailAt ?? nameAt;
	const lines = flow(
		leadLines(
			`${indent(BRANCH_AT)}${paint.dim(last ? "└─" : "├─")} ${glyph}`,
			nameAt,
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
	// With a sibling below, the branch runs on past this child's lines, which
	// all open with spaces to at least column 6.
	const trunk = `${indent(BRANCH_AT)}${paint.dim("│")}`;
	return lines
		.map((line, index) =>
			last || index === 0 ? line : trunk + line.slice(BRANCH_AT + 1),
		)
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
