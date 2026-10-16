import { indent, MARGIN, roomFrom, visibleWidth, wrap } from "./layout.js";
import { LEAD_AT, renderSteps } from "./remedy.js";
import type { Style } from "./style.js";
import type { NextItem } from "./types.js";

/** What the reader can do about the run, gathered for its close. */
export function renderNext(
	items: readonly NextItem[],
	width: number,
	style: Style,
): string[] {
	if (items.length === 0) {
		return [];
	}
	return [
		"",
		`${MARGIN}${style.bold("Next")}`,
		...items.flatMap((item, index) => [
			...(index === 0 ? [] : [""]),
			...heading(item, width, style),
			...renderSteps(item.remedy.steps, width, style),
		]),
	];
}

/** `<subject> — <lead>`, the lead's first letter lowered to run on from the dash. */
function heading(item: NextItem, width: number, style: Style): string[] {
	const room = roomFrom(LEAD_AT, width);
	const prefix = `${item.subject} — `;
	const lead =
		item.remedy.lead.charAt(0).toLowerCase() + item.remedy.lead.slice(1);
	const [first = "", ...rest] = wrap(lead, room, room - visibleWidth(prefix));
	const opening = `${style.bold(item.subject)} —${first === "" ? "" : ` ${first}`}`;
	return [opening, ...rest].map((line) => indent(LEAD_AT) + line);
}
