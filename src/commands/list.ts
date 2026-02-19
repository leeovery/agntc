import { Command } from "commander";
import * as p from "@clack/prompts";

export const listCommand = new Command("list")
  .description("List installed plugins")
  .action(() => {
    p.intro("agntc list");
    p.log.info("No plugins installed.");
    p.outro("Done (stub)");
  });
