import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { updateCommand } from "./commands/update.js";

const program = new Command();

program
	.name("agntc")
	.description("Agent skills and knowledge installer for AI coding agents")
	.version("0.0.1");

program.addCommand(addCommand);
program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);
program.addCommand(updateCommand);

program.showHelpAfterError(true);

program.action(() => {
	program.outputHelp();
});

program.parse();
