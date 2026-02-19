import { Command } from "commander";
import * as p from "@clack/prompts";

export const addCommand = new Command("add")
  .description("Install a plugin from a git repo or local path")
  .argument("<source>", "Git repo (owner/repo) or local path")
  .action((source: string) => {
    p.intro("agntc add");
    p.log.info(`Adding plugin from: ${source}`);
    p.outro("Done (stub)");
  });
