export type AgentId = "claude" | "codex";

export interface AgentDriver {
  detect(projectDir: string): Promise<boolean>;
  getTargetDir(assetType: string): string | null;
}
