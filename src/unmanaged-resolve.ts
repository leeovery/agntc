import { isCancel, select, confirm } from "@clack/prompts";

export interface UnmanagedPluginConflicts {
  pluginKey: string;
  files: string[];
}

export interface UnmanagedResolution {
  approved: string[];
  cancelled: string[];
}

/**
 * Interactively resolves unmanaged file conflicts per plugin.
 * Each plugin is handled independently: overwrite-all (with double confirm)
 * or cancel that plugin's install.
 *
 * @param conflicts - Per-plugin conflict groups
 * @returns Approved files (OK to overwrite) and cancelled files (skip install)
 */
export async function resolveUnmanagedConflicts(
  conflicts: UnmanagedPluginConflicts[],
): Promise<UnmanagedResolution> {
  const approved: string[] = [];
  const cancelled: string[] = [];

  if (conflicts.length === 0) {
    return { approved, cancelled };
  }

  for (const { pluginKey, files } of conflicts) {
    const fileList = files.map((f) => `  - ${f}`).join("\n");

    const choice = await select({
      message: `Unmanaged files found for "${pluginKey}":\n${fileList}\nHow would you like to proceed?`,
      options: [
        {
          value: "overwrite" as const,
          label: "Overwrite all — replace these files",
        },
        {
          value: "cancel" as const,
          label: "Cancel this plugin's install",
        },
      ],
    });

    if (isCancel(choice) || choice === "cancel") {
      cancelled.push(...files);
      continue;
    }

    // choice === "overwrite" — require second confirmation
    const confirmed = await confirm({
      message:
        "Are you sure? These files will be permanently replaced.",
    });

    if (isCancel(confirmed) || !confirmed) {
      cancelled.push(...files);
      continue;
    }

    approved.push(...files);
  }

  return { approved, cancelled };
}
