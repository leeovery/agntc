import type { Message } from "../message.js";
import { indent, MARGIN, prose, roomFrom, wrap } from "./layout.js";
import { LEAD_AT, renderRemedy } from "./remedy.js";
import { identity, type Painter, type Style, statusGlyph } from "./style.js";
import type { Status } from "./types.js";

export type MessageKind = "warn" | "note" | "error";

export const KIND_STATUS: Record<MessageKind, Status> = {
	warn: "attention",
	note: "note",
	error: "failed",
};

/** ` ! text` (` · ` a note, ` ✗ ` an error, bold), its cause dim, then its remedy. */
export function renderMessage(
	kind: MessageKind,
	message: Message,
	width: number,
	style: Style,
): string[] {
	const { text, cause, remedy } =
		typeof message === "string" ? { text: message } : message;
	const textPaint = kind === "error" ? style.bold : identity;
	const [first = "", ...rest] = wrap(text, roomFrom(LEAD_AT, width));
	const opening = first === "" ? "" : ` ${textPaint(first)}`;
	return [
		`${MARGIN}${statusGlyph(KIND_STATUS[kind], style)}${opening}`,
		...rest.map((line) => indent(LEAD_AT) + textPaint(line)),
		...prose(cause ?? "", LEAD_AT, width, style.dim),
		...(remedy === undefined ? [] : renderRemedy(remedy, width, style)),
	];
}

/** How a written text's lines are painted: the first, then the rest, as the first unless given. */
export interface WrittenPaint {
	first?: Painter;
	rest?: Painter;
}

/**
 * ` ✓ text`, each of the text's lines as written, those after the first at
 * column 3. Nothing is wrapped, so a command written into a sentence stays
 * whole for the terminal to wrap. Blank lines at the end are left off.
 */
export function renderWritten(
	status: Status,
	text: string,
	style: Style,
	{
		first: paintFirst = identity,
		rest: paintRest = paintFirst,
	}: WrittenPaint = {},
): string[] {
	const [first = "", ...rest] = text.trimEnd().split("\n");
	const opening = `${MARGIN}${statusGlyph(status, style)} `;
	const after = indent(LEAD_AT);
	const line = (lead: string, written: string, paint: Painter) =>
		written === "" ? lead.trimEnd() : lead + paint(written);
	return [
		line(opening, first, paintFirst),
		...rest.map((written) => line(after, written, paintRest)),
	];
}
