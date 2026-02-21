# CLAUDE.md

## Project Overview

agntc is a CLI tool for installing AI agent skills from git repos. Supports Claude and Codex through a driver architecture.

## Commands

- `add <source>` — Install from git/local. Interactive agent + plugin selection.
- `remove [key]` — Remove plugin(s). Interactive if no arg.
- `update [key]` — Nuke-and-reinstall at same ref. No arg = all.
- `list` — Dashboard with update status + inline actions.

## Source Code Structure

```
src/
  cli.ts              # Entry point, commander setup
  commands/           # add, remove, update, list
  drivers/            # Agent drivers (claude, codex) + registry
  source-parser.ts    # Parse owner/repo, URLs, local paths, tree URLs
  type-detection.ts   # Detect skill vs plugin vs collection
  manifest.ts         # Read/write .agntc/manifest.json
  config.ts           # Read/validate agntc.json
  git-clone.ts        # Shallow clone with retry
  git-utils.ts        # ls-remote, ref resolution
  update-check.ts     # Compare manifest vs remote
  summary.ts          # Format install/remove/update summaries
```

## Key Types

- `AgentId`: `"claude" | "codex"`
- `AgentDriver`: Detection + routing per agent
- `PluginConfig`: Shape of `agntc.json`
- `ManifestEntry`: Per-plugin tracking (ref, commit, agents, files)
- `DetectedType`: `"skill" | "plugin" | "collection"`

## Asset Routing

| Asset | Claude | Codex |
|-------|--------|-------|
| skills | `.claude/skills/` | `.agents/skills/` |
| agents | `.claude/agents/` | — |
| hooks | `.claude/hooks/` | — |

## Update Strategy

Nuke-and-reinstall: delete manifest `files`, re-clone at same ref, re-copy for same agents.

## Testing

```bash
pnpm test
```

## Build

```bash
pnpm build
```

Output: `dist/cli.js`
