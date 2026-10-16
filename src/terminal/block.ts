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
	type Painter,
	type Style,
	statusGlyph,
	statusTone,
} from "./style.js";
import type { Child, Detail, Row, Status } from "./types.js";

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
const COLUMN_GAP = 3;
const MIN_GAP = 2;
const SUBJECT_SHARE = 0.45;

/** Painters that paint nothing, for a line dimmed whole: dim can't nest in dim. */
const PLAIN = createStyle(0);
const unpainted: Painter = (text) => text;

export function blockLayout(rows: readonly Row[], width: number): BlockLayout {
	const subjectWidth = Math.min(
		widest(rows.map((row) => row.subject)) + COLUMN_GAP,
		Math.floor(width * SUBJECT_SHARE),
	);
	const metas = rows.flatMap((row) =>
		row.meta === undefined ? [] : [row.meta],
	);
	const metaWidth = metas.length === 0 ? 0 : widest(metas) + COLUMN_GAP;
	return {
		subjectWidth,
		metaWidth,
		detailAt: SUBJECT_AT + subjectWidth + metaWidth,
	};
}

function widest(texts: readonly string[]): number {
	return Math.max(0, ...texts.map(visibleWidth));
}

/** A row and its children, as lines. */
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
	const [first, ...rest] = detailLines(
		row.detail,
		roomFrom(layout.detailAt, width),
		row.status,
		paint,
	);
	const meta = row.meta === undefined ? "" : paint.dim(row.meta);
	const head =
		first === undefined
			? meta || undefined
			: pad(meta, layout.metaWidth) + first;
	return hang(
		`${MARGIN}${statusGlyph(row.status, paint)} ${paint.bold(row.subject)}`,
		head,
		rest,
		SUBJECT_AT + layout.subjectWidth,
		layout.detailAt,
	);
}

function narrowRow(row: Row, width: number, paint: Style): string[] {
	const meta = row.meta === undefined ? "" : `  ${paint.dim(row.meta)}`;
	const [first, ...rest] = detailLines(
		row.detail,
		roomFrom(SUBJECT_AT, width),
		row.status,
		paint,
	);
	return hang(
		`${MARGIN}${statusGlyph(row.status, paint)} ${paint.bold(row.subject)}${meta}`,
		first,
		rest,
		SUBJECT_AT,
		SUBJECT_AT,
	);
}

function detailLines(
	detail: Detail | undefined,
	room: number,
	status: Status,
	paint: Style,
): string[] {
	if (detail === undefined) {
		return [];
	}
	if (typeof detail === "string") {
		return wrap(detail, room);
	}
	const { from, to } = detail.move;
	const move = `${paint.dim(`${from} →`)} ${paint.bold(to)}`;
	return [
		detail.note === undefined
			? move
			: `${move}  ${statusTone(status, paint)(detail.note)}`,
	];
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
	const tone = childDetailIsDim(rowStatus, child.status)
		? paint.dim
		: unpainted;
	const [first, ...rest] =
		child.detail === undefined
			? []
			: wrap(child.detail, roomFrom(at, width)).map(tone);
	return hang(
		`   ${paint.dim(last ? "└─" : "├─")} ${glyph}${child.name}`,
		first,
		rest,
		at,
		at,
	).map(dimWhole(quiet, style));
}

/** A child's reason is read, so it stays normal; a done row's notes stay quiet. */
function childDetailIsDim(
	rowStatus: Status,
	childStatus: Status | undefined,
): boolean {
	const quietRow = rowStatus === "done" || rowStatus === "unchanged";
	const quietChild =
		childStatus === undefined ||
		childStatus === "done" ||
		childStatus === "unchanged";
	return quietRow && quietChild;
}

/**
 * `lead`, then `first` at `firstAt` and `rest` at `restAt`. A lead reaching
 * within two columns of `firstAt` sends `first` to a line of its own.
 */
function hang(
	lead: string,
	first: string | undefined,
	rest: readonly string[],
	firstAt: number,
	restAt: number,
): string[] {
	const continued = rest.map((line) => indent(restAt) + line);
	if (first === undefined) {
		return [lead, ...continued];
	}
	if (visibleWidth(lead) + MIN_GAP <= firstAt) {
		return [pad(lead, firstAt) + first, ...continued];
	}
	return [lead, indent(firstAt) + first, ...continued];
}

function dimWhole(quiet: boolean, style: Style): (line: string) => string {
	return (line) =>
		quiet ? MARGIN + style.dim(line.slice(MARGIN.length)) : line;
}
