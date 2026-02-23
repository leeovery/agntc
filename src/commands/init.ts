import * as p from "@clack/prompts";
import { Command } from "commander";
import type { AgentId } from "../drivers/types.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { selectInitAgents } from "../init/agent-select.js";
import { formatInitReport } from "../init/format-report.js";
import { preCheck } from "../init/pre-check.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { scaffoldCollection } from "../init/scaffold-collection.js";
import { scaffoldPlugin } from "../init/scaffold-plugin.js";
import { scaffoldSkill } from "../init/scaffold-skill.js";
import type { ScaffoldResult } from "../init/scaffold-utils.js";
import type { InitType } from "../init/type-select.js";
import { selectInitType } from "../init/type-select.js";

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

	const reconfigure = preCheckResult.status === "reconfigure";
	const result = await scaffold(type, agents, process.cwd(), reconfigure);

	p.outro(formatInitReport(result, type));
}

async function scaffold(
	type: InitType,
	agents: AgentId[],
	targetDir: string,
	reconfigure: boolean,
): Promise<ScaffoldResult> {
	const options = reconfigure
		? { agents, targetDir, reconfigure: true as const }
		: { agents, targetDir };

	if (type === "collection") {
		return scaffoldCollection(options);
	}
	if (type === "plugin") {
		return scaffoldPlugin(options);
	}
	return scaffoldSkill(options);
}

export const initCommand = new Command("init")
	.description("Scaffold a new agntc plugin")
	.allowExcessArguments(true)
	.action(
		withExitSignal(async () => {
			await runInit();
		}),
	);
