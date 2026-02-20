import { Command } from "commander";
import * as p from "@clack/prompts";
import { readManifest, type ManifestEntry } from "../manifest.js";
import { checkAllForUpdates } from "../update-check-all.js";
import type { UpdateCheckResult } from "../update-check.js";
import { ExitSignal } from "../exit-signal.js";

const DONE_VALUE = "__done__";

function formatLabel(key: string, entry: ManifestEntry): string {
  if (entry.ref !== null) {
    return `${key}@${entry.ref}`;
  }
  return key;
}

function formatStatusHint(result: UpdateCheckResult): string {
  switch (result.status) {
    case "up-to-date":
      return "\u2713 Up to date";
    case "update-available":
      return "\u2191 Update available";
    case "newer-tags":
      return "\u2691 Newer tags available";
    case "check-failed":
      return "\u2717 Check failed";
    case "local":
      return "\u25CF Local";
  }
}

export async function runList(): Promise<string | null> {
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
    return null;
  }

  const spin = p.spinner();
  spin.start("Checking for updates...");
  const checkResults = await checkAllForUpdates(manifest);
  spin.stop("Update checks complete.");

  const options = entries.map(([key, entry]) => {
    const result = checkResults.get(key) ?? {
      status: "check-failed" as const,
      reason: "unknown",
    };
    return {
      value: key,
      label: formatLabel(key, entry),
      hint: formatStatusHint(result),
    };
  });

  options.push({
    value: DONE_VALUE,
    label: "Done",
    hint: "",
  });

  const selected = await p.select<string>({
    message: "Select a plugin to manage",
    options,
  });

  if (p.isCancel(selected) || selected === DONE_VALUE) {
    return null;
  }

  return selected;
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
