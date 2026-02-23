import { confirm, isCancel, note } from "@clack/prompts";
import type { InitType } from "./type-select.js";

const filesByType: Partial<Record<InitType, string[]>> = {
	skill: ["agntc.json", "SKILL.md"],
	plugin: [
		"agntc.json",
		"skills/",
		"  my-skill/",
		"    SKILL.md",
		"agents/",
		"hooks/",
	],
	collection: [
		"my-plugin/",
		"  agntc.json",
		"  skills/",
		"    my-skill/",
		"      SKILL.md",
		"  agents/",
		"  hooks/",
	],
};

export async function previewAndConfirm(options: {
	type: InitType;
}): Promise<boolean> {
	const files = filesByType[options.type];

	if (!files) {
		throw new Error(`Init type "${options.type}" is not yet supported`);
	}

	note(files.map((f) => `  ${f}`).join("\n"), "This will create:");

	const result = await confirm({ message: "Proceed?" });

	if (isCancel(result) || result === false) {
		return false;
	}

	return true;
}
