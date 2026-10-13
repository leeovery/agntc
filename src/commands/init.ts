import { Command } from "commander";
import { commandAction, jsonOption } from "../command-action.js";
import { ExitSignal } from "../exit-signal.js";
import { formatInitReport } from "../init/format-report.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { scaffoldCollection } from "../init/scaffold-collection.js";
import { scaffoldPlugin } from "../init/scaffold-plugin.js";
import { scaffoldSkill } from "../init/scaffold-skill.js";
import type { ScaffoldResult } from "../init/scaffold-utils.js";
import type { InitType } from "../init/type-select.js";
import { selectInitType } from "../init/type-select.js";
import { interactiveUi, type Ui } from "../ui.js";

export async function runInit(ui: Ui = interactiveUi): Promise<void> {
	if (ui.mode === "machine") {
		ui.fail("agntc init needs a terminal");
	}

	ui.intro("agntc init");

	const type = await selectInitType(ui);
	if (type === null) {
		ui.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const confirmed = await previewAndConfirm({ type }, ui);
	if (!confirmed) {
		ui.cancel("Cancelled");
		throw new ExitSignal(0);
	}

	const result = await scaffold(type, process.cwd());

	ui.outro(formatInitReport(result, type));
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
	.addOption(jsonOption())
	.action(commandAction("init", (ui) => runInit(ui)));
