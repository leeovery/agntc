# Specification: Cursor Agent Driver

## Specification

## Cursor Driver

Cursor 2.4+ natively reads SKILL.md files — the same format used by Claude and Codex. No format conversion needed. Note: agntc does not gate on Cursor version, but skills won't function on versions below 2.4.

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

New file `src/drivers/cursor-driver.ts` implementing `AgentDriver` (detect + getTargetDir). Register in the driver registry (`src/drivers/registry.ts`). Update `AgentId` union in `src/drivers/types.ts` and `KNOWN_AGENTS` in `src/config.ts`.

## Agent Selection: Filter to Declared Agents

Currently `selectAgents()` shows all registered agents as options. Agents not declared in the plugin's `agntc.json` get a hint `"not declared by plugin"` — but this hint only appears when the option is highlighted (a `@clack/prompts` behavior). Users can still select undeclared agents.

### Change

`selectAgents()` filters the multiselect to only agents present in the plugin's `declaredAgents` set. Undeclared agents are excluded entirely — no hint needed because they're not shown.

For declared agents that are **not detected** in the project, show a persistent hint `"(not detected in project)"` — visible at all times, not just when highlighted. This gives useful context without offering unsupported options.

### Implementation

Modify `selectAgents()` in `src/agent-select.ts`.

### Rationale

Plugin authors declare specific agents intentionally — a Claude-only skill may use features like sub-agents that don't exist in other agents. Respecting the declaration is correct. Adding a third agent makes showing irrelevant options more noticeable.

## Collection Pipeline: Silent Skip for Undeclared Agents

The collection pipeline (`add.ts`) unions all declared agents from selected plugins into a single `selectAgents` call. After selection, it currently warns per-plugin: "Plugin X does not declare support for Y. Installing at your own risk."

### Change

When iterating plugins in the collection pipeline, filter `selectedAgents` to only those declared by each specific plugin before copying. No warning, no "at your own risk" — just don't copy files for agents the plugin doesn't support. The manifest entry for each plugin records only the agents it was actually installed for.

### Rationale

The warning-and-install-anyway model is wrong. If a plugin doesn't declare an agent, the correct behavior is to skip, not warn. The union approach for `selectAgents` already limits the prompt to agents declared by at least one plugin in the collection.

### Implementation

Modify the collection pipeline in `src/commands/add.ts` (lines 420-442 area).

## Agent Selection: Auto-Skip When Unambiguous

If a plugin declares a single agent and that agent is detected locally, the multiselect prompt offers one pre-checked option — unnecessary friction.

### Change

Auto-skip the agent selection prompt when the result is unambiguous. Rules:

- **One declared, detected** → auto-select, skip prompt, log which agent was selected
- **One declared, NOT detected** → show prompt with `"(not detected in project)"` hint
- **Multiple declared** → always show prompt

### Implementation

Modify `selectAgents()` in `src/agent-select.ts` — same function as the filtering change.

### Rationale

Only fires when completely unambiguous. The "not detected" edge case warrants user confirmation — the user should consciously opt in to installing for an agent not present in the project.

---

## Working Notes

[Optional - capture in-progress discussion if needed]
