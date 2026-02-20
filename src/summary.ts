import { getDriver } from "./drivers/registry.js";
import type { AgentId, AssetType } from "./drivers/types.js";
import type { AssetCounts } from "./copy-plugin-assets.js";

export function formatRefLabel(
  ref: string | null,
  commit: string | null,
): string {
  if (ref !== null) return ref;
  if (commit === null) return "local";
  return "HEAD";
}

export function formatPluginSummary(
  agentIds: AgentId[],
  assetCountsByAgent: Partial<Record<AgentId, AssetCounts>>,
): string {
  const parts: string[] = [];

  for (const id of agentIds) {
    const counts = assetCountsByAgent[id];
    if (!counts) continue;

    const nonZero = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${count} ${type.replace(/s$/, "")}(s)`)
      .join(", ");

    if (nonZero.length > 0) {
      parts.push(`${id}: ${nonZero}`);
    }
  }

  return parts.join(", ");
}

export function formatBareSkillSummary(
  agentIds: AgentId[],
  copiedFiles: string[],
): string {
  return agentIds
    .map((id) => {
      const driver = getDriver(id);
      const targetPrefix = driver.getTargetDir("skills");
      const count = copiedFiles.filter(
        (f) => targetPrefix !== null && f.startsWith(targetPrefix),
      ).length;
      return `${id}: ${count} skill(s)`;
    })
    .join(", ");
}

interface AddSummaryInput {
  manifestKey: string;
  ref: string | null;
  commit: string | null;
  detectedType: "plugin" | "bare-skill";
  selectedAgents: AgentId[];
  assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
  copiedFiles: string[];
}

export function renderAddSummary(input: AddSummaryInput): string {
  const refLabel = formatRefLabel(input.ref, input.commit);
  const agentSummary =
    input.detectedType === "plugin" && input.assetCountsByAgent
      ? formatPluginSummary(input.selectedAgents, input.assetCountsByAgent)
      : formatBareSkillSummary(input.selectedAgents, input.copiedFiles);

  return `Installed ${input.manifestKey}@${refLabel} — ${agentSummary}`;
}

interface CollectionPluginResult {
  pluginName: string;
  status: "installed" | "skipped" | "failed";
  copiedFiles: string[];
  assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
  detectedType?: { type: string };
  errorMessage?: string;
}

interface CollectionAddSummaryInput {
  manifestKey: string;
  ref: string | null;
  commit: string | null;
  selectedAgents: AgentId[];
  results: CollectionPluginResult[];
}

export function renderCollectionAddSummary(
  input: CollectionAddSummaryInput,
): string {
  const refLabel = formatRefLabel(input.ref, input.commit);
  const installed = input.results.filter((r) => r.status === "installed");
  const skipped = input.results.filter((r) => r.status === "skipped");
  const failed = input.results.filter((r) => r.status === "failed");

  const pluginSummaries = installed.map((r) => {
    if (r.detectedType?.type === "plugin" && r.assetCountsByAgent) {
      return `${r.pluginName}: ${formatPluginSummary(input.selectedAgents, r.assetCountsByAgent)}`;
    }
    return `${r.pluginName}: ${formatBareSkillSummary(input.selectedAgents, r.copiedFiles)}`;
  });

  const summaryParts = [...pluginSummaries];
  if (skipped.length > 0) {
    summaryParts.push(`${skipped.length} skipped`);
  }
  if (failed.length > 0) {
    for (const f of failed) {
      summaryParts.push(`${f.pluginName}: failed — ${f.errorMessage}`);
    }
  }

  return `Installed ${input.manifestKey}@${refLabel} — ${summaryParts.join(", ")}`;
}

interface GitUpdateSummaryInput {
  key: string;
  oldCommit: string | null;
  newCommit: string;
  copiedFiles: string[];
  effectiveAgents: string[];
  droppedAgents: string[];
}

export function renderGitUpdateSummary(input: GitUpdateSummaryInput): string {
  const oldShort = input.oldCommit ? input.oldCommit.slice(0, 7) : "unknown";
  const newShort = input.newCommit.slice(0, 7);
  const droppedSuffix =
    input.droppedAgents.length > 0
      ? `. ${input.droppedAgents.join(", ")} support removed by plugin author.`
      : "";
  return `Updated ${input.key}: ${oldShort} -> ${newShort} — ${input.copiedFiles.length} file(s) for ${input.effectiveAgents.join(", ")}${droppedSuffix}`;
}

interface LocalUpdateSummaryInput {
  key: string;
  copiedFiles: string[];
  effectiveAgents: string[];
  droppedAgents: string[];
}

export function renderLocalUpdateSummary(
  input: LocalUpdateSummaryInput,
): string {
  const droppedSuffix =
    input.droppedAgents.length > 0
      ? `. ${input.droppedAgents.join(", ")} support removed by plugin author.`
      : "";
  return `Refreshed ${input.key} — ${input.copiedFiles.length} file(s) for ${input.effectiveAgents.join(", ")}${droppedSuffix}`;
}

type UpdateOutcomeInput =
  | {
      type: "git-update";
      key: string;
      oldCommit: string | null;
      newCommit: string;
      droppedAgents: string[];
    }
  | {
      type: "local-update";
      key: string;
      droppedAgents: string[];
    };

export function renderUpdateOutcomeSummary(input: UpdateOutcomeInput): string {
  if (input.type === "git-update") {
    const oldShort = input.oldCommit
      ? input.oldCommit.slice(0, 7)
      : "unknown";
    const newShort = input.newCommit.slice(0, 7);
    const droppedSuffix =
      input.droppedAgents.length > 0
        ? ` — ${input.droppedAgents.join(", ")} support removed by plugin author`
        : "";
    return `${input.key}: Updated ${oldShort} -> ${newShort}${droppedSuffix}`;
  }

  const droppedSuffix =
    input.droppedAgents.length > 0
      ? ` — ${input.droppedAgents.join(", ")} support removed by plugin author`
      : "";
  return `${input.key}: Refreshed from local path${droppedSuffix}`;
}

interface RemoveSummaryInput {
  summaryLabel: string;
  fileCount: number;
}

export function renderRemoveSummary(input: RemoveSummaryInput): string {
  return `Removed ${input.summaryLabel} — ${input.fileCount} file(s)`;
}
