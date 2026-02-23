import type { ScaffoldResult } from "./scaffold-skill.js";
import type { InitType } from "./type-select.js";

const successMessageByType: Record<InitType, string> = {
	skill: "Done. Edit `SKILL.md` to define your skill.",
	plugin: "Done. Add your skills, agents, and hooks.",
	collection:
		"Done. Rename `my-plugin/` and duplicate for each plugin in your collection.",
};

export function formatInitReport(
	result: ScaffoldResult,
	type: InitType,
): string {
	const overwritten = result.overwritten;
	const lines: string[] = [];

	for (const file of result.created) {
		lines.push(file);
	}

	for (const file of overwritten) {
		lines.push(`${file} (overwritten)`);
	}

	for (const file of result.skipped) {
		lines.push(`${file} (already exists)`);
	}

	const parts: string[] = [];

	if (lines.length > 0) {
		parts.push(lines.join(", "));
	}

	if (result.created.length > 0 || overwritten.length > 0) {
		parts.push(successMessageByType[type]);
	}

	return parts.join("\n");
}
