import { readFileSync } from "node:fs";
import { Command } from "commander";
import { renderBanner } from "./banner.js";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { updateCommand } from "./commands/update.js";

// Read the version from the installed package.json at RUNTIME (not an import — tsup
// would inline that at build time). package.json is the single source of truth: the
// publish workflow stamps it from the release tag, so the CLI always reports the
// version of the package it's actually running from. No tags, no network — one local
// file read at startup. Falls back to the placeholder if the read ever fails.
const DEV_PLACEHOLDER = "0.0.0-development";

function readVersion(): string {
	try {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { version?: string };
		return pkg.version ?? DEV_PLACEHOLDER;
	} catch {
		return DEV_PLACEHOLDER;
	}
}

const VERSION = readVersion();
// The unpublished placeholder is honest for `--version` but noise in the banner —
// hide it there, show it everywhere it's a real release.
const BANNER_VERSION = VERSION === DEV_PLACEHOLDER ? undefined : VERSION;

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

// No subcommand: show the usual help (Usage / Commands). The banner is printed
// once below, before parsing, so it appears here too.
program.action(() => {
	program.outputHelp();
});

// Show the banner on every invocation — the no-args landing, every command, and
// --help — so the brand is always present. The lone exception is a bare version
// query (`--version`/`-V`), kept clean for scripts that capture stdout.
const argv = process.argv.slice(2);
const isVersionQuery = argv.includes("--version") || argv.includes("-V");
if (!isVersionQuery) {
	console.log(renderBanner(BANNER_VERSION));
}

program.parse();
