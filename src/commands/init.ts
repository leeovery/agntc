import * as p from "@clack/prompts";
import { Command } from "commander";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { selectInitAgents } from "../init/agent-select.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { scaffoldSkill } from "../init/scaffold-skill.js";
import { selectInitType } from "../init/type-select.js";

export async function runInit(): Promise<void> {
	p.intro("agntc init");

	const type = await selectInitType();
	if (type === null) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	if (type === "plugin" || type === "collection") {
		p.cancel("Plugin and Collection scaffolding coming soon");
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

	const result = await scaffoldSkill({ agents, targetDir: process.cwd() });

	const parts: string[] = [];

	if (result.skipped.length > 0) {
		parts.push(`Skipped (already exists): ${result.skipped.join(", ")}`);
	}

	if (result.created.length > 0) {
		parts.push("Done. Edit `SKILL.md` to define your skill.");
	}

	p.outro(parts.join("\n"));
}

export const initCommand = new Command("init")
	.description("Scaffold a new agntc plugin")
	.allowExcessArguments(true)
	.action(
		withExitSignal(async () => {
			await runInit();
		}),
	);
