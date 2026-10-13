import { join } from "node:path";
import { declaresPack, readConfig } from "../config.js";
import { pathExists } from "../fs-utils.js";
import type { Scaffold } from "./scaffold-utils.js";
import { AGENT_MD, HOOK_SH, PACK_CONFIG, skillMd } from "./templates.js";

/** The folder itself becomes the pack, declared by its `agntc.json`. */
export const packScaffold: Scaffold = {
	files: () => [
		{ path: "agntc.json", content: PACK_CONFIG },
		{ path: "skills/my-skill/SKILL.md", content: skillMd("my-skill") },
		{ path: "agents/my-agent.md", content: AGENT_MD },
		{ path: "hooks/my-hook.sh", content: HOOK_SH, mode: 0o755 },
	],
	warnings: async (targetDir) => {
		const warnings: string[] = [];
		if (!declaresPack(await readConfig(targetDir))) {
			warnings.push(
				'agntc.json was already here and doesn\'t declare a pack — add "type": "pack" to it',
			);
		}
		if (await pathExists(join(targetDir, "SKILL.md"))) {
			warnings.push(
				"SKILL.md here makes this folder a skill, not a pack — move it under skills/",
			);
		}
		return warnings;
	},
};
