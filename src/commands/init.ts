import { homedir } from "node:os";
import { Argument, Command } from "commander";
import { commandAction, jsonOption } from "../command-action.js";
import { ExitSignal } from "../exit-signal.js";
import {
	initTally,
	NEXT_STEP,
	scaffoldedRows,
	scaffoldRow,
} from "../init/init-render.js";
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
import { sentence } from "../message.js";
import { homeShortened } from "../scope.js";
import { interactiveUi, type Ui } from "../ui.js";

export interface InitOptions {
	/** Scaffold without the preview and its confirmation. */
	yes?: boolean;
}

const scaffolds: Record<InitType, Scaffold> = {
	skill: skillScaffold,
	pack: packScaffold,
};

/**
 * Scaffolds a skill or a pack in the working folder, once asked under the
 * row of the files it will create, or told to by `-y`: a row per file,
 * created or left as it was, then what the folder still needs.
 */
export async function runInit(
	given: InitType | undefined,
	options: InitOptions,
	ui: Ui = interactiveUi(),
): Promise<void> {
	ui.header();

	const type = given ?? (await chooseType(ui));
	const targetDir = process.cwd();
	const scaffold = scaffolds[type];
	const files = scaffold.files(targetDir);

	await confirmScaffold(
		type,
		homeShortened(targetDir, homedir()),
		files,
		options,
		ui,
	);

	const result = await writeScaffold(targetDir, files);
	const rows = scaffoldedRows(
		files.map(({ path }) => path),
		result,
	);
	const block = ui.block(rows);
	for (const row of rows) {
		block.row(row);
	}
	for (const warning of await scaffold.warnings(targetDir)) {
		ui.warn(sentence(warning));
	}
	// Machine mode's document says what was created; the next step is the terminal's.
	if (ui.mode === "interactive" && result.created.length > 0) {
		ui.note(sentence(NEXT_STEP[type]));
	}
	ui.close({ command: "init", counts: initTally(result) });
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

/**
 * `-y` answers the question; without it, machine mode refuses before
 * anything is written, and a terminal asks under the row of the files, the
 * folder named as the row shows it.
 */
async function confirmScaffold(
	type: InitType,
	folder: string,
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
	const row = scaffoldRow(
		folder,
		type,
		files.map(({ path }) => path),
	);
	if (!(await ui.block([row]).confirm(row, { message: "Proceed?" }))) {
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
