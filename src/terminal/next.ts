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
	const subject = wrap(item.subject, room);
	const end = subject.pop() ?? "";
	const { lead } = item.remedy;
	const [first = "", ...rest] =
		lead === ""
			? []
			: wrap(
					`— ${lead.charAt(0).toLowerCase()}${lead.slice(1)}`,
					room,
					room - visibleWidth(end) - 1,
				);
	const opening = [end === "" ? "" : style.bold(end), first]
		.filter((part) => part !== "")
		.join(" ");
	return [...subject.map(style.bold), opening, ...rest]
		.filter((line) => line !== "")
		.map((line) => indent(LEAD_AT) + line);
}
