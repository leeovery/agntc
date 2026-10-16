import {
	indent,
	isNarrow,
	MARGIN,
	pad,
	roomFrom,
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
import type { Child, Detail, Move, Row, Status } from "./types.js";

/** Where a block's columns sit, fixed from every row it will hold. */
export interface BlockLayout {
	subjectWidth: number;
	metaWidth: number;
	detailAt: number;
}

/** ` ✓ ` before a row's subject. */
const SUBJECT_AT = 3;
/** `   ├─ ` before a child's name. */
const CHILD_AT = 6;
/** A child's status glyph and its space, after the branch. */
const CHILD_GLYPH = 2;
const COLUMN_GAP = 3;
const MIN_GAP = 2;
const SUBJECT_SHARE = 0.45;
/** The least room the meta column leaves the detail. */
const MIN_DETAIL_ROOM = 20;

/** Painters that paint nothing, for a line dimmed whole: dim can't nest in dim. */
const PLAIN = createStyle(0);

export function blockLayout(rows: readonly Row[], width: number): BlockLayout {
	const subjectWidth = Math.min(
		widest(rows.flatMap(subjectMeasures)) + COLUMN_GAP,
		Math.floor(width * SUBJECT_SHARE),
	);
	const metas = rows.flatMap((row) =>
		row.meta ? [visibleWidth(row.meta)] : [],
	);
	const metaWidth =
		metas.length === 0
			? 0
			: Math.min(
					widest(metas) + COLUMN_GAP,
					Math.max(
						0,
						roomFrom(SUBJECT_AT + subjectWidth, width) - MIN_DETAIL_ROOM,
					),
				);
	return {
		subjectWidth,
		metaWidth,
		detailAt: SUBJECT_AT + subjectWidth + metaWidth,
	};
}

/** How far into the subject column a row's subject and each child's name reach. */
function subjectMeasures(row: Row): number[] {
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
	const narrow = isNarrow(width);
	const quiet = row.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const lines = narrow
		? narrowRow(row, width, paint)
		: wideRow(row, layout, width, paint);
	const children = row.children ?? [];
	return [
		...lines.map(dimWhole(quiet, style)),
		...children.flatMap((child, index) =>
			renderChild(child, index === children.length - 1, row.status, {
				at: narrow ? CHILD_AT : layout.detailAt,
				width,
				style,
			}),
		),
	];
}

function wideRow(
	row: Row,
	layout: BlockLayout,
	width: number,
	paint: Style,
): string[] {
	const metaAt = SUBJECT_AT + layout.subjectWidth;
	const room = roomFrom(layout.detailAt, width);
	return flow(rowLead(row, width, paint), [
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
function narrowRow(row: Row, width: number, paint: Style): string[] {
	const room = roomFrom(SUBJECT_AT, width);
	const lead = rowLead(row, width, paint);
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

function rowLead(row: Row, width: number, paint: Style): string[] {
	return leadLines(
		`${MARGIN}${statusGlyph(row.status, paint)} `,
		SUBJECT_AT,
		row.subject,
		paint.bold,
		width,
	);
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
	return moveLines(
		detail.move,
		detail.note,
		rooms,
		statusTone(status, paint),
		paint,
	);
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
	at: number;
	width: number;
	style: Style;
}

function renderChild(
	child: Child,
	last: boolean,
	rowStatus: Status,
	{ at, width, style }: ChildPlace,
): string[] {
	const quiet = rowStatus === "unchanged" || child.status === "unchanged";
	const paint = quiet ? PLAIN : style;
	const glyph =
		child.status === undefined ? "" : `${statusGlyph(child.status, paint)} `;
	const tone = isRead(child.status ?? rowStatus) ? identity : paint.dim;
	const nameAt = CHILD_AT + (child.status === undefined ? 0 : CHILD_GLYPH);
	return flow(
		leadLines(
			`   ${paint.dim(last ? "└─" : "├─")} ${glyph}`,
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
	).map(dimWhole(quiet, style));
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
