import { basename } from "node:path";
import type { Scaffold } from "./scaffold-utils.js";
import { skillMd } from "./templates.js";

/** The folder itself becomes the skill, named after it. */
export const skillScaffold: Scaffold = {
	files: (targetDir) => [
		{ path: "SKILL.md", content: skillMd(basename(targetDir)) },
	],
	warnings: async () => [],
};
