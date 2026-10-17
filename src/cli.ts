import { Command } from "commander";
import { renderBanner } from "./banner.js";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { updateCommand } from "./commands/update.js";
import { BANNER_VERSION, VERSION } from "./version.js";

const program = new Command();

// No `.description()` on purpose — the banner's tagline is the single identity
// line, so commander's help doesn't repeat it.
program.name("agntc").version(VERSION);

program.addCommand(addCommand);
program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);
program.addCommand(updateCommand);

program.showHelpAfterError(true);

// The banner heads every help screen, the no-args landing included; a command
// run opens with its one-line header instead. A bare version query stays clean
// for scripts that capture stdout.
program.addHelpText("beforeAll", renderBanner(BANNER_VERSION));

program.action(() => {
	program.outputHelp();
});

await program.parseAsync();
