import type { Ui } from "../ui.js";
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

export async function previewAndConfirm(
	options: { type: InitType },
	ui: Ui,
): Promise<boolean> {
	const files = filesByType[options.type];

	ui.box(files.map((f) => `  ${f}`).join("\n"), "This will create:");

	return ui.confirm({ message: "Proceed?" });
}
