# Specification: Cursor Agent Driver

## Specification

## Cursor Driver

### Target Directory

Skills install to `.cursor/skills/`. Each agent owns its directory — consistent with the existing model (Claude → `.claude/skills/`, Codex → `.agents/skills/`). `.cursor/skills/` is a first-class Cursor skill directory confirmed via Cursor documentation.

### Asset Types

Skills only. Cursor has no agents or hooks system. `TARGET_DIRS` is `Partial<Record<AssetType, string>>` with just `skills: ".cursor/skills"` — same shape as `CodexDriver`. `getTargetDir()` returns `null` for unsupported asset types.

### Asset Routing (updated)

| Asset  | Claude             | Codex             | Cursor             |
|--------|--------------------|-------------------|--------------------|
| skills | `.claude/skills/`  | `.agents/skills/` | `.cursor/skills/`  |
| agents | `.claude/agents/`  | —                 | —                  |
| hooks  | `.claude/hooks/`   | —                 | —                  |

### Detection

Three-tier detection, matching the established pattern used by Claude and Codex drivers:

1. `.cursor/` directory at project level
2. `which cursor` CLI check
3. `~/.cursor/` home directory fallback

### AgentId Type

Add `"cursor"` to the explicit `AgentId` union type (`"claude" | "codex" | "cursor"`) and to the `KNOWN_AGENTS` const array. Keep the explicit union — three members is still small, compile-time exhaustiveness checking is valuable, and a plugin-based architecture is premature.

### Implementation

New file `src/drivers/cursor-driver.ts` implementing `AgentDriver` (detect + getTargetDir). Register in the driver registry (`src/drivers/registry.ts`). Update `AgentId` union in `src/drivers/types.ts` and `KNOWN_AGENTS` in `src/drivers/types.ts` (or wherever it's defined).

## Agent Selection: Filter to Declared Agents

Currently `selectAgents()` shows all registered agents as options. Agents not declared in the plugin's `agntc.json` get a hint `"not declared by plugin"` — but this hint only appears when the option is highlighted (a `@clack/prompts` behavior). Users can still select undeclared agents.

### Change

`selectAgents()` filters the multiselect to only agents present in the plugin's `declaredAgents` set. Undeclared agents are excluded entirely — no hint needed because they're not shown.

For declared agents that are **not detected** in the project, show a persistent hint `"(not detected in project)"` — visible at all times, not just when highlighted. This gives useful context without offering unsupported options.

### Rationale

Plugin authors declare specific agents intentionally — a Claude-only skill may use features like sub-agents that don't exist in other agents. Respecting the declaration is correct. Adding a third agent makes showing irrelevant options more noticeable.

---

## Working Notes

[Optional - capture in-progress discussion if needed]
