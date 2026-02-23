import * as p from "@clack/prompts";
import { Command } from "commander";
import type { AgentId } from "../drivers/types.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { selectInitAgents } from "../init/agent-select.js";
import { preCheck } from "../init/pre-check.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { scaffoldCollection } from "../init/scaffold-collection.js";
import { scaffoldPlugin } from "../init/scaffold-plugin.js";
import { scaffoldSkill } from "../init/scaffold-skill.js";
import type { InitType } from "../init/type-select.js";
import { selectInitType } from "../init/type-select.js";

const successMessageByType: Record<InitType, string> = {
	skill: "Done. Edit `SKILL.md` to define your skill.",
	plugin: "Done. Add your skills, agents, and hooks.",
	collection:
		"Done. Rename `my-plugin/` and duplicate for each plugin in your collection.",
};

export async function runInit(): Promise<void> {
	p.intro("agntc init");

	const preCheckResult = await preCheck(process.cwd());
	if (preCheckResult.status === "cancel") {
		p.cancel("Operation cancelled.");
		throw new ExitSignal(0);
	}

	const type = await selectInitType();
	if (type === null) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const agents = await selectInitAgents();
	if (agents === null) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const confirmed = await previewAndConfirm({ type });
	if (!confirmed) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const result = await scaffold(type, agents, process.cwd());

	const parts: string[] = [];

	if (result.skipped.length > 0) {
		parts.push(`Skipped (already exists): ${result.skipped.join(", ")}`);
	}

	if (result.created.length > 0) {
		parts.push(successMessageByType[type]);
	}

	p.outro(parts.join("\n"));
}

async function scaffold(
	type: InitType,
	agents: AgentId[],
	targetDir: string,
): Promise<{ created: string[]; skipped: string[] }> {
	if (type === "collection") {
		return scaffoldCollection(targetDir, agents);
	}
	if (type === "plugin") {
		return scaffoldPlugin(targetDir, agents);
	}
	return scaffoldSkill({ agents, targetDir });
}

export const initCommand = new Command("init")
	.description("Scaffold a new agntc plugin")
	.allowExcessArguments(true)
	.action(
		withExitSignal(async () => {
			await runInit();
		}),
	);
