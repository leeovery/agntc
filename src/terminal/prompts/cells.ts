import type { Choice, ChoiceCell } from "../../ui.js";
import {
	indent,
	pad,
	truncate,
	truncateStart,
	visibleWidth,
} from "../layout.js";
import { createStyle, identity, type Style, statusGlyph } from "../style.js";

/** The columns between a label and its first cell, and between cells. */
const CELL_GAP = 3;
const PLAIN = createStyle(0);

/** A choice as its line lays it out: the columns its label is indented by. */
export interface PlacedChoice<T> {
	choice: Choice<T>;
	inset: number;
}

/** Where a select's cells sit, laid out once from every choice. */
export interface CellLayout {
	/** Where the first cell starts, counted from where the options do. */
	labelColumn: number;
	/** The cells kept, by their place in a choice's cells, and where each starts. */
	cells: readonly { index: number; at: number }[];
	/** Whether the cells keep their asides. */
	asides: boolean;
}

/**
 * The columns `choices` line up in, inside `room`: the widest label (with its
 * inset) and 3, then each cell as wide as the widest in its column and 3.
 * Where that's too wide, the asides go first, then the cells before the last,
 * from the right, the last kept; then the label column narrows, its labels
 * cut at their start, as a name is told apart by its tail.
 */
export function cellLayout<T>(
	choices: readonly PlacedChoice<T>[],
	room: number,
): CellLayout {
	const count = Math.max(
		0,
		...choices.map(({ choice }) => cellsOf(choice).length),
	);
	const label = widest(
		choices.map(({ choice, inset }) => inset + visibleWidth(choice.label)),
	);
	const widths = (asides: boolean) =>
		Array.from({ length: count }, (_, index) =>
			widest(
				choices.map(({ choice }) => {
					const cell = cellsOf(choice)[index];
					return cell === undefined ? 0 : cellWidth(cell, asides);
				}),
			),
		);
	let asides = true;
	let columns = widths(asides);
	let kept = Array.from({ length: count }, (_, index) => index);
	const span = () =>
		kept.reduce((total, index) => total + (columns[index] ?? 0), 0) +
		CELL_GAP * Math.max(0, kept.length - 1);
	const fits = () => label + CELL_GAP + span() <= room;
	if (!fits()) {
		asides = false;
		columns = widths(asides);
	}
	while (!fits() && kept.length > 1) {
		kept = [...kept.slice(0, -2), ...kept.slice(-1)];
	}
	const labelColumn = Math.max(0, Math.min(label + CELL_GAP, room - span()));
	let at = labelColumn;
	const cells = kept.map((index) => {
		const placed = { index, at };
		at += (columns[index] ?? 0) + CELL_GAP;
		return placed;
	});
	return { labelColumn, cells, asides };
}

/**
 * A choice's line inside `room`, from where the options start: its label,
 * bold on the cursor's row and cut at its start to end 3 short of the first
 * cell, then each kept cell at its column.
 */
export function cellsText<T>(
	{ choice, inset }: PlacedChoice<T>,
	layout: CellLayout,
	room: number,
	style: Style,
	current: boolean,
): string {
	const labelRoom = Math.max(0, layout.labelColumn - CELL_GAP - inset);
	const label = truncateStart(choice.label, labelRoom);
	let line =
		label === ""
			? ""
			: indent(inset) + (current ? style.bold : identity)(label);
	const cells = cellsOf(choice);
	for (const { index, at } of layout.cells) {
		const cell = cells[index];
		if (cell !== undefined) {
			line = pad(line, at) + cellText(cell, layout.asides, style);
		}
	}
	return truncate(line, room);
}

function cellsOf<T>(choice: Choice<T>): readonly ChoiceCell[] {
	return choice.cells ?? [];
}

function cellWidth(cell: ChoiceCell, asides: boolean): number {
	return visibleWidth(cellText(cell, asides, PLAIN));
}

/** Its glyph, its text and its aside, a space apart, leaving out what it hasn't. */
function cellText(cell: ChoiceCell, asides: boolean, style: Style): string {
	return [
		cell.status === undefined ? "" : statusGlyph(cell.status, style),
		cell.dim ? style.dim(cell.text) : cell.text,
		asides && cell.aside ? style.dim(cell.aside) : "",
	]
		.filter((part) => visibleWidth(part) > 0)
		.join(" ");
}

function widest(widths: readonly number[]): number {
	return Math.max(0, ...widths);
}

/** Whether any of the choices carries cells, which then take the hints' place. */
export function hasCells<T>(choices: readonly Choice<T>[]): boolean {
	return choices.some((choice) => cellsOf(choice).length > 0);
}
