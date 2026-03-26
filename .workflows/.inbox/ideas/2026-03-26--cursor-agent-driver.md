# Cursor Agent Driver

agntc currently supports Claude and Codex through its driver architecture. Cursor 2.4+ natively reads SKILL.md files — the same format used by both existing agents — which means adding Cursor as a third supported agent requires no format conversion at all. The driver would be thin: detection, a target directory, and registration.

Cursor auto-discovers skills from multiple directories: `.cursor/skills/`, `.agents/skills/` (shared with Codex), `~/.cursor/skills/` (global), and `.claude/skills/` as a legacy fallback. The interesting design decision is whether the Cursor driver should target `.cursor/skills/` (giving it its own namespace, consistent with how Claude owns `.claude/skills/`) or `.agents/skills/` (sharing with Codex, which is how Vercel's skills CLI does it). Option 1 fits agntc's model better where each agent owns its directory. Option 2 means Cursor is effectively an alias for the Codex skill path. Either works since Cursor reads from both locations.

Cursor only supports skills — no agents or hooks asset types. So the driver's `TARGET_DIRS` would map skills to its chosen directory and leave agents/hooks unsupported. This is similar to how Codex already lacks hooks support.

Detection would check for a `.cursor/` directory at project level, falling back to `which cursor` or `~/.cursor/` existence at system level. Registration follows the existing pattern: a new `src/drivers/cursor-driver.ts` implementing `AgentDriver`, adding `"cursor"` to `KNOWN_AGENTS` in `src/config.ts`, and wiring it into `src/drivers/registry.ts` and `src/drivers/identify.ts`.

Cursor also has an older rules system (`.cursor/rules/*.mdc`) with declarative always-on policies, but that's a separate system from skills and not relevant to agntc's model. Skills are the correct abstraction — they're dynamic, procedural, portable across agents, and invocable via slash commands.

Research notes with sources and implementation details are captured in `CURSOR-DRIVER-RESEARCH.md` at the project root.
