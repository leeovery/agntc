import type { Remedy, Step } from "../message.js";
import { indent, roomFrom, wrap } from "./layout.js";
import type { Style } from "./style.js";

/** Where a remedy's lead and what it says to read sit. */
export const LEAD_AT = 3;
const STEP_AT = 5;

/** The lead, wrapped at column 3, then its steps. */
export function renderRemedy(
	remedy: Remedy,
	width: number,
	style: Style,
): string[] {
	return [
		...wrap(remedy.lead, roomFrom(LEAD_AT, width)).map(
			(line) => indent(LEAD_AT) + line,
		),
		...renderSteps(remedy.steps, width, style),
	];
}

/**
 * Each step at column 5. A command is a line of its own, never wrapped or
 * cut, so a triple-click copies it clean.
 */
export function renderSteps(
	steps: readonly Step[],
	width: number,
	style: Style,
): string[] {
	const at = indent(STEP_AT);
	const command = (text: string) => at + style.accent(text);
	return steps.flatMap((step, index) => {
		if ("command" in step) {
			return [command(step.command)];
		}
		if ("choice" in step) {
			const lead = index === 0 ? "one of" : "then one of";
			return [at + style.dim(lead), ...step.choice.map(command)];
		}
		return wrap(step.words, roomFrom(STEP_AT, width)).map((line) => at + line);
	});
}
