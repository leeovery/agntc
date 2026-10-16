import type { Message } from "../message.js";
import { indent, MARGIN, roomFrom, wrap } from "./layout.js";
import { LEAD_AT, renderRemedy } from "./remedy.js";
import { type Painter, type Style, statusGlyph } from "./style.js";
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
	const room = roomFrom(LEAD_AT, width);
	const hanging = (paint: Painter) => (line: string) =>
		indent(LEAD_AT) + paint(line);
	const textPaint = kind === "error" ? style.bold : (line: string) => line;
	const [first = "", ...rest] = wrap(text, room);
	return [
		`${MARGIN}${statusGlyph(KIND_STATUS[kind], style)} ${textPaint(first)}`,
		...rest.map(hanging(textPaint)),
		...(cause === undefined ? [] : wrap(cause, room).map(hanging(style.dim))),
		...(remedy === undefined ? [] : renderRemedy(remedy, width, style)),
	];
}
