# Discussion: Cursor Agent Driver

## Context

agntc currently supports two agents (Claude and Codex) through a driver architecture. Each driver implements `AgentDriver` (detect + getTargetDir) and is registered in the driver registry. Cursor 2.4+ natively reads SKILL.md files — the same format used by both existing agents — so adding Cursor as a third agent requires no format conversion.

The driver architecture is clean: `AgentId` type union, `AgentDriver` interface, per-driver `TARGET_DIRS`, detection logic, and a central registry. Adding a new driver means a new file, a type union update, a `KNOWN_AGENTS` entry, and registry wiring.

The inbox idea includes research notes referencing `CURSOR-DRIVER-RESEARCH.md` at the project root with additional implementation details.

### References

- Inbox idea: `.workflows/.inbox/.archived/ideas/2026-03-26--cursor-agent-driver.md`
- Research: `CURSOR-DRIVER-RESEARCH.md` (sources, directory listings, Vercel reference)
- Existing drivers: `src/drivers/claude-driver.ts`, `src/drivers/codex-driver.ts`
- Driver interface: `src/drivers/types.ts`
- Registry: `src/drivers/registry.ts`

## Questions

- [x] Which target directory should the Cursor driver use for skills?
- [x] How should detection work for Cursor?
- [x] What asset types should the Cursor driver support?
- [x] Should the AgentId type be widened beyond a string literal union?

---

## Which target directory should the Cursor driver use for skills?

### Context

Cursor auto-discovers skills from four directories: `.agents/skills/`, `.cursor/skills/`, `~/.cursor/skills/` (global), and `.claude/skills/` (legacy fallback). The question is which one agntc should target when installing skills for Cursor.

### Options Considered

**Option 1: `.cursor/skills/` (own namespace)**
- Consistent with agntc's model where each agent owns its directory (Claude → `.claude/skills/`, Codex → `.agents/skills/`)
- Clean file ownership — `identifyFileOwnership()` won't have ambiguous matches
- Removing one agent doesn't affect another's files
- Confirmed valid: Cursor reads from this directory as a first-class location

**Option 2: `.agents/skills/` (shared with Codex)**
- How Vercel's skills CLI does it
- Avoids duplicate files on disk when both Codex and Cursor are installed
- But creates implicit coupling — Codex removal could affect Cursor
- `identifyFileOwnership()` would match whichever agent is checked first in the registry loop
- Installing a skill for "cursor only" still writes to an `.agents/` path, which is confusing

### Decision

**`.cursor/skills/`** — own namespace. Consistent with agntc's per-agent directory model. The disk cost of duplicating small SKILL.md files is negligible compared to the operational clarity of clean ownership boundaries. Verified that `.cursor/skills/` is a first-class Cursor skill directory per Cursor docs (confirmed via live fetch of cursor.com/docs/context/skills).

---

## How should detection work for Cursor?

### Context

Each existing driver uses a tiered detection strategy: project directory → CLI binary → home directory. The question is whether Cursor should follow the same pattern.

### Decision

Three-tier detection, matching the established pattern:

1. `.cursor/` directory at project level
2. `which cursor` CLI check
3. `~/.cursor/` home directory fallback

Straightforward — the pattern is proven across both existing drivers and maps directly to Cursor's filesystem presence. No debate needed.

---

## What asset types should the Cursor driver support?

### Decision

**Skills only.** Cursor has no agents or hooks system. `TARGET_DIRS` will be `Partial<Record<AssetType, string>>` with just `skills: ".cursor/skills"` — identical in shape to `CodexDriver`. `getTargetDir()` returns `null` for unsupported types. No debate needed.

---

## Should the AgentId type be widened beyond a string literal union?

### Context

`AgentId` is currently `"claude" | "codex"`. Adding `"cursor"` makes it three members. Question is whether to keep the explicit union or move to something more dynamic.

### Options Considered

**Keep explicit union**
- Three members is still small — adding a fourth is one line in `types.ts`, one in `config.ts`
- Compile-time exhaustiveness checking on `switch` statements
- `KNOWN_AGENTS` const array stays in sync naturally

**Widen to string or make plugin-based**
- Would support arbitrary user-defined agents
- Loses compile-time safety
- Premature — that's a different architecture entirely

### Decision

**Keep the explicit union.** Add `"cursor"` to `AgentId` and `KNOWN_AGENTS`. The union is small, the type safety is valuable, and designing for hypothetical plugin-based agents is premature.
