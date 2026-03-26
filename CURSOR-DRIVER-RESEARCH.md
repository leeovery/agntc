# Cursor Driver Research

Research notes for adding Cursor as a supported agent in agntc.

## Key Finding

Cursor 2.4+ natively reads `SKILL.md` files — the same format used by Claude and Codex. No format conversion is needed.

## Cursor's Skill Directories

Cursor auto-discovers skills from these locations:

| Directory | Scope |
|-----------|-------|
| `.agents/skills/` | Project (shared with Codex) |
| `.cursor/skills/` | Project (Cursor-specific) |
| `~/.cursor/skills/` | Global |
| `.claude/skills/` | Legacy fallback |

## SKILL.md Compatibility

Cursor reads the same SKILL.md frontmatter as Claude/Codex:

```yaml
---
name: my-skill
description: When to use this skill
license: MIT
metadata:
  author: someone
  version: "1.0.0"
---
```

Skills can include `references/`, `rules/`, `scripts/`, and `assets/` subdirectories — all standard agntc plugin structure.

## Skills vs Rules (Two Separate Systems)

Cursor has an older **rules** system (`.cursor/rules/*.mdc`) which is unrelated to skills:

- **Rules** — declarative, always-on policies with `alwaysApply`/`globs` frontmatter. Injected into system prompt based on file matching.
- **Skills** — dynamic, procedural instructions. Agent discovers and applies them contextually. Can be invoked via `/` slash commands. Portable across agents.

The `.mdc` format is not relevant for agntc. Skills are the correct abstraction.

## Vercel Skills CLI Reference

The Vercel `skills` CLI (github.com/vercel-labs/skills) treats Cursor as reading from `.agents/skills/` — the same directory as Codex. Their agent config:

```js
cursor: {
  name: 'cursor',
  skillsDir: '.agents/skills',
  globalSkillsDir: join(home, '.cursor/skills'),
}
```

No format conversion is performed. The same SKILL.md is used by all agents.

## Implementation Plan

### Driver Configuration

```typescript
// src/drivers/cursor-driver.ts
const TARGET_DIRS: Partial<Record<AssetType, string>> = {
  skills: ".cursor/skills",   // or ".agents/skills" to share with Codex
  // agents: null — not supported
  // hooks: null — not supported
};
```

### Key Decision: Target Directory

Two options for where Cursor skills go:

1. **`.cursor/skills/`** — Cursor-specific, no overlap with Codex
2. **`.agents/skills/`** — Shared with Codex (how Vercel does it), but then installing for "codex" already covers Cursor

Option 1 is cleaner for agntc's model (each agent owns its directory). Option 2 means Cursor is effectively an alias for Codex's skill path. Either works since Cursor reads from both.

### Detection

| Check | Method |
|-------|--------|
| Project-level | `.cursor/` directory exists |
| System fallback | `which cursor` or `~/.cursor/` exists |

### Registration

1. Create `src/drivers/cursor-driver.ts` implementing `AgentDriver`
2. Add `"cursor"` to `KNOWN_AGENTS` in `src/config.ts`
3. Register in `src/drivers/registry.ts`
4. Update agent detection in `src/drivers/identify.ts`

### Scope

Skills only — Cursor does not support agents or hooks asset types.

## Sources

- Cursor Agent Skills docs: cursor.com/docs/context/skills
- Cursor Rules docs: cursor.com/docs/context/rules
- Cursor 2.4 changelog (skills introduction): cursor.com/changelog/2-4
- Vercel Skills repo: github.com/vercel-labs/skills
- Cursor forum — skills installed as rules bug (fixed in 2.6.19): forum.cursor.com/t/skills-are-installed-as-rules/152793
