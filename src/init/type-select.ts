import type { Ui } from "../ui.js";

export const INIT_TYPES = ["skill", "pack"] as const;

export type InitType = (typeof INIT_TYPES)[number];

export async function selectInitType(ui: Ui): Promise<InitType | null> {
	return ui.select<InitType>({
		message: "What are you creating?",
		options: [
			{
				value: "skill",
				label: "Skill",
				hint: "a single skill (SKILL.md)",
			},
			{
				value: "pack",
				label: "Pack",
				hint: "skills, agents and hooks that install together as one",
			},
		],
	});
}
