import { isCancel, select } from "@clack/prompts";

export type InitType = "skill" | "plugin" | "collection";

export async function selectInitType(): Promise<InitType | null> {
	const result = await select<InitType>({
		message: "What are you creating?",
		options: [
			{
				value: "skill",
				label: "Skill",
				hint: "a single skill (SKILL.md)",
			},
			{
				value: "plugin",
				label: "Plugin",
				hint: "skills, agents, and/or hooks that install together as one package",
			},
			{
				value: "collection",
				label: "Collection",
				hint: "a repo of individually selectable plugins",
			},
		],
	});

	if (isCancel(result)) {
		return null;
	}

	return result;
}
