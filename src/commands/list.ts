import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifest, type ManifestEntry } from "../manifest.js";
import { ExitSignal } from "../exit-signal.js";

function formatVersion(entry: ManifestEntry): string {
  if (entry.ref !== null) {
    return `@${entry.ref}`;
  }
  if (entry.commit) {
    return "HEAD";
  }
  return "local";
}

function formatDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

export async function runList(): Promise<void> {
  const manifest = await readManifest(process.cwd()).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(`Failed to read manifest: ${message}`);
    throw new ExitSignal(1);
  });

  const entries = Object.entries(manifest);

  if (entries.length === 0) {
    p.outro(
      "No plugins installed. Run npx agntc add owner/repo to get started.",
    );
    return;
  }

  p.intro("Installed plugins");

  for (const [key, entry] of entries) {
    const version = formatVersion(entry);
    const agents = entry.agents.join(", ");
    const date = formatDate(entry.installedAt);
    p.log.message(`${key} ${version}  agents: ${agents}  installed: ${date}`);
  }

  p.outro("");
}

export const listCommand = new Command("list")
  .description("List installed plugins")
  .action(async () => {
    try {
      await runList();
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
