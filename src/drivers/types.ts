export type AgentId = "claude" | "codex";

export type AssetType = "skills" | "agents" | "hooks";

export interface AgentDriver {
	detect(projectDir: string): Promise<boolean>;
	getTargetDir(assetType: AssetType): string | null;
}

export interface AgentWithDriver {
	id: AgentId;
	driver: AgentDriver;
}
