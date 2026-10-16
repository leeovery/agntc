import type { Advice, SubjectMessage } from "../message.js";
import { indent, MARGIN, roomFrom, visibleWidth, wrap } from "./layout.js";
import { LEAD_AT, renderSteps } from "./remedy.js";
import type { Style } from "./style.js";
import type { NextItem } from "./types.js";

/** The remedy a message carries, under its subject: the row already says what happened. */
export function remedyItem(message: SubjectMessage): NextItem | null {
	return message.remedy === undefined
		? null
		: { subject: message.subject, remedy: message.remedy };
}

/** A message whose row says less than it does: what it says leads its remedy. */
export function adviceItem(message: Advice): NextItem {
	const { lead, steps } = message.remedy;
	return {
		subject: message.subject,
		remedy: { lead: `${message.detail} ${lead}`, steps },
	};
}

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

/**
 * `<subject> — <lead>`, the lead running on from the dash with its first
 * letter lowered. Either alone stands without the dash, the lead as written.
 */
function heading(item: NextItem, width: number, style: Style): string[] {
	const room = roomFrom(LEAD_AT, width);
	const subject = wrap(item.subject, room);
	const end = subject.pop() ?? "";
	const { lead } = item.remedy;
	const tail = lead === "" || end === "" ? lead : `— ${runningOn(lead)}`;
	const [first = "", ...rest] =
		tail === ""
			? []
			: wrap(tail, room, end === "" ? room : room - visibleWidth(end) - 1);
	const opening = [end === "" ? "" : style.bold(end), first]
		.filter((part) => part !== "")
		.join(" ");
	return [...subject.map(style.bold), opening, ...rest]
		.filter((line) => line !== "")
		.map((line) => indent(LEAD_AT) + line);
}

/**
 * `To update it anyway:` as `to update …`. A first word with a capital past
 * its first letter (`GitHub`, `SKILL.md`) is a name, and keeps its case.
 */
function runningOn(lead: string): string {
	const [word = ""] = lead.split(" ");
	return /\p{Lu}/u.test(word.slice(1))
		? lead
		: lead.charAt(0).toLowerCase() + lead.slice(1);
}
