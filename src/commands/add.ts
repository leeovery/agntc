import { Command } from "commander";
import * as p from "@clack/prompts";
import { parseSource } from "../source-parser.js";

export const addCommand = new Command("add")
  .description("Install a plugin from a git repo or local path")
  .argument("<source>", "Git repo (owner/repo) or local path")
  .action((source: string) => {
    p.intro("agntc add");

    const parsed = parseSource(source);

    p.log.info(`Adding plugin from: ${parsed.manifestKey}`);
    if (parsed.ref) {
      p.log.info(`Ref: ${parsed.ref}`);
    }
    p.outro("Done (stub)");
  });
