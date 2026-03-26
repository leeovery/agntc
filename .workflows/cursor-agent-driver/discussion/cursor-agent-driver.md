# Discussion: Cursor Agent Driver

## Context

agntc currently supports two agents (Claude and Codex) through a driver architecture. Each driver implements `AgentDriver` (detect + getTargetDir) and is registered in the driver registry. Cursor 2.4+ natively reads SKILL.md files — the same format used by both existing agents — so adding Cursor as a third agent requires no format conversion.

The driver architecture is clean: `AgentId` type union, `AgentDriver` interface, per-driver `TARGET_DIRS`, detection logic, and a central registry. Adding a new driver means a new file, a type union update, a `KNOWN_AGENTS` entry, and registry wiring.

The inbox idea includes research notes referencing `CURSOR-DRIVER-RESEARCH.md` at the project root with additional implementation details.

### References

- Inbox idea: `.workflows/.inbox/.archived/ideas/2026-03-26--cursor-agent-driver.md`
- Existing drivers: `src/drivers/claude-driver.ts`, `src/drivers/codex-driver.ts`
- Driver interface: `src/drivers/types.ts`
- Registry: `src/drivers/registry.ts`

## Questions

- [ ] Which target directory should the Cursor driver use for skills?
      - `.cursor/skills/` (own namespace, consistent with Claude owning `.claude/skills/`)
      - `.agents/skills/` (shared with Codex, how Vercel's skills CLI does it)
      - Cursor reads from both locations
- [ ] How should detection work for Cursor?
      - Project-level `.cursor/` directory
      - `which cursor` CLI check
      - `~/.cursor/` home directory fallback
- [ ] What asset types should the Cursor driver support?
      - Cursor only supports skills — no agents or hooks
      - Similar to Codex which already lacks hooks support
- [ ] Should the AgentId type be widened beyond a string literal union?
      - Currently `"claude" | "codex"` — adding `"cursor"` is straightforward
      - But as more agents are added, is the pattern sustainable?
