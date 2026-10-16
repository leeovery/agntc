import { Argument, Command } from "commander";
import { commandAction, jsonOption } from "../command-action.js";
import { ExitSignal } from "../exit-signal.js";
import { formatInitReport } from "../init/format-report.js";
import { previewAndConfirm } from "../init/preview-confirm.js";
import { packScaffold } from "../init/scaffold-pack.js";
import { skillScaffold } from "../init/scaffold-skill.js";
import {
	type Scaffold,
	type ScaffoldFile,
	writeScaffold,
} from "../init/scaffold-utils.js";
import {
	INIT_TYPES,
	type InitType,
	selectInitType,
} from "../init/type-select.js";
import { interactiveUi, type Ui } from "../ui.js";

export interface InitOptions {
	/** Scaffold without the preview and its confirmation. */
	yes?: boolean;
}

const scaffolds: Record<InitType, Scaffold> = {
	skill: skillScaffold,
	pack: packScaffold,
};

export async function runInit(
	given: InitType | undefined,
	options: InitOptions,
	ui: Ui = interactiveUi(),
): Promise<void> {
	ui.intro("agntc init");

	const type = given ?? (await chooseType(ui));
	const targetDir = process.cwd();
	const scaffold = scaffolds[type];
	const files = scaffold.files(targetDir);

	await confirmScaffold(type, files, options, ui);

	const result = await writeScaffold(targetDir, files);
	for (const warning of await scaffold.warnings(targetDir)) {
		ui.warn(warning);
	}
	ui.outro(formatInitReport(result, type));
	ui.report({ type, files: result.created, skipped: result.skipped });
}

/** The menu answers what the type argument didn't; machine mode can't show it. */
async function chooseType(ui: Ui): Promise<InitType> {
	if (ui.mode === "machine") {
		ui.fail(
			"init needs to know what to scaffold without a terminal: npx agntc init skill or npx agntc init pack",
			{ flags: [...INIT_TYPES] },
		);
	}
	const type = await selectInitType(ui);
	if (type === null) {
		return cancel(ui);
	}
	return type;
}

/** `-y` answers the question; without it, machine mode refuses before anything is written. */
async function confirmScaffold(
	type: InitType,
	files: ScaffoldFile[],
	options: InitOptions,
	ui: Ui,
): Promise<void> {
	if (options.yes) {
		return;
	}
	if (ui.mode === "machine") {
		ui.fail(
			`scaffolding a ${type} asks before writing anything — confirm with -y`,
			{ flags: ["-y"] },
		);
	}
	if (!(await previewAndConfirm(files, ui))) {
		cancel(ui);
	}
}

function cancel(ui: Ui): never {
	ui.cancel("Cancelled");
	throw new ExitSignal(0);
}

export const initCommand = new Command("init")
	.description("Scaffold a new skill or pack in the current folder")
	.addArgument(new Argument("[type]", "What to scaffold").choices(INIT_TYPES))
	.option("-y, --yes", "Scaffold without asking for confirmation")
	.addOption(jsonOption())
	.action(
		commandAction(
			"init",
			(ui, _scope, type: InitType | undefined, options: InitOptions) =>
				runInit(type, options, ui),
		),
	);
