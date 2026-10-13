import * as p from "@clack/prompts";
import { Command } from "commander";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
import { formatInitReport } from "../init/format-report.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { scaffoldCollection } from "../init/scaffold-collection.js";
import { scaffoldPlugin } from "../init/scaffold-plugin.js";
import { scaffoldSkill } from "../init/scaffold-skill.js";
import type { ScaffoldResult } from "../init/scaffold-utils.js";
import type { InitType } from "../init/type-select.js";
import { selectInitType } from "../init/type-select.js";

export async function runInit(): Promise<void> {
	p.intro("agntc init");

	const type = await selectInitType();
	if (type === null) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const confirmed = await previewAndConfirm({ type });
	if (!confirmed) {
		p.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const result = await scaffold(type, process.cwd());

	p.outro(formatInitReport(result, type));
}

async function scaffold(
	type: InitType,
	targetDir: string,
): Promise<ScaffoldResult> {
	if (type === "collection") {
		return scaffoldCollection({ targetDir });
	}
	if (type === "plugin") {
		return scaffoldPlugin({ targetDir });
	}
	return scaffoldSkill({ targetDir });
}

export const initCommand = new Command("init")
	.description("Scaffold a new agntc plugin")
	.action(
		withExitSignal(async () => {
			await runInit();
		}),
	);
