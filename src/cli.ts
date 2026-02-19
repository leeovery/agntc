import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { listCommand } from "./commands/list.js";

const program = new Command();

program
  .name("agntc")
  .description("Agent skills and knowledge installer for AI coding agents")
  .version("0.0.1");

program.addCommand(addCommand);
program.addCommand(listCommand);

program.showHelpAfterError(true);

program.action(() => {
  program.outputHelp();
});

program.parse();
