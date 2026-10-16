import type { Message } from "../message.js";
import { indent, MARGIN, prose, roomFrom, wrap } from "./layout.js";
import { LEAD_AT, renderRemedy } from "./remedy.js";
import { identity, type Style, statusGlyph } from "./style.js";
import type { Status } from "./types.js";

export type MessageKind = "warn" | "note" | "error";

const KIND_STATUS: Record<MessageKind, Status> = {
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
