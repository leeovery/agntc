import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId } from "./drivers/types.js";

export interface AgntcConfig {
  agents: AgentId[];
}

export const KNOWN_AGENTS = ["claude", "codex"] as const;

export interface ReadConfigOptions {
  onWarn?: (message: string) => void;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function readConfig(
  dir: string,
  options?: ReadConfigOptions,
): Promise<AgntcConfig | null> {
  const filePath = join(dir, "agntc.json");

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid agntc.json: ${detail}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("agents" in parsed)
  ) {
    throw new ConfigError("agents field is required");
  }

  const { agents } = parsed as { agents: unknown };

  if (!Array.isArray(agents) || agents.length === 0) {
    throw new ConfigError("agents must not be empty");
  }

  const knownSet = new Set<string>(KNOWN_AGENTS);
  const filtered: AgentId[] = [];

  for (const agent of agents) {
    if (typeof agent === "string" && knownSet.has(agent)) {
      filtered.push(agent as AgentId);
    } else if (typeof agent === "string") {
      options?.onWarn?.(`Unknown agent "${agent}" — skipping`);
    }
  }

  return { agents: filtered };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
