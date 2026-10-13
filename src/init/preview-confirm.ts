import { confirm, isCancel, note } from "@clack/prompts";
import type { InitType } from "./type-select.js";

const filesByType: Record<InitType, string[]> = {
	skill: ["SKILL.md"],
	plugin: ["skills/", "  my-skill/", "    SKILL.md", "agents/", "hooks/"],
	collection: [
		"my-plugin/",
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

	note(files.map((f) => `  ${f}`).join("\n"), "This will create:");

	const result = await confirm({ message: "Proceed?" });

	if (isCancel(result) || result === false) {
		return false;
	}

	return true;
}
