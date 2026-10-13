import type { ScaffoldResult } from "./scaffold-utils.js";
import type { InitType } from "./type-select.js";

const successMessageByType: Record<InitType, string> = {
	skill: "Done. Edit `SKILL.md` to define your skill.",
	pack: "Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
};

export function formatInitReport(
	result: ScaffoldResult,
	type: InitType,
): string {
	const lines: string[] = [];

	for (const file of result.created) {
		lines.push(file);
	}

	for (const file of result.skipped) {
		lines.push(`${file} (already exists)`);
	}

	const parts: string[] = [];

	if (lines.length > 0) {
		parts.push(lines.join(", "));
	}

	if (result.created.length > 0) {
		parts.push(successMessageByType[type]);
	}

	return parts.join("\n");
}
