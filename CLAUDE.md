# CLAUDE.md

## Project Overview

agntc is a CLI tool for installing AI agent skills from git repos. Supports Claude, Codex, and Cursor through a driver architecture.

## Commands

- `init` — Scaffold new plugin. Interactive type + agent selection.
- `add <source>` — Install from git/local. Semver constraint auto-detection. Interactive agent + plugin selection.
- `remove [key]` — Remove plugin(s). Interactive if no arg.
- `update [key]` — Nuke-and-reinstall. Respects version constraints. No arg = all.
- `list` — Dashboard with update status + inline actions (update, remove, change version).

## Source Code Structure

```
src/
  cli.ts              # Entry point, commander setup
  commands/           # add, remove, update, list, init
  drivers/            # Agent drivers (claude, codex, cursor) + registry
  init/               # Plugin scaffolding (skill, plugin, collection)
  source-parser.ts    # Parse owner/repo, URLs, local paths, tree URLs
  type-detection.ts   # Detect skill vs plugin vs collection
  manifest.ts         # Read/write .agntc/manifest.json
  config.ts           # Read/validate agntc.json
  git-clone.ts        # Shallow clone with retry
  git-utils.ts        # ls-remote, ref resolution
  update-check.ts     # Compare manifest vs remote (incl. constrained checks)
  version-resolve.ts  # Semver tag resolution (resolveVersion, resolveLatestVersion)
  summary.ts          # Format install/remove/update summaries
```

## Key Types

- `AgentId`: `"claude" | "codex" | "cursor"`
- `AgentDriver`: Detection + routing per agent
- `PluginConfig`: Shape of `agntc.json`
- `ManifestEntry`: Per-plugin tracking (ref, commit, agents, files, constraint)
- `DetectedType`: `"skill" | "plugin" | "collection"`
- `UpdateCheckResult`: Union of update statuses including constrained variants

## Asset Routing

| Asset | Claude | Codex | Cursor |
|-------|--------|-------|--------|
| skills | `.claude/skills/` | `.agents/skills/` | `.cursor/skills/` |
| agents | `.claude/agents/` | — | — |
| hooks | `.claude/hooks/` | — | — |

## Version Constraints

- `owner/repo` (bare add) — auto-resolves latest semver tag, stores `^major.minor.patch` constraint
- `owner/repo@^1.0` — explicit constraint, resolves best match within range
- `owner/repo@v2.0.0` — exact tag, no constraint stored
- Constraints stored in `ManifestEntry.constraint`, used by `update` to stay within range
- `list` detail view shows out-of-constraint versions when available
- "Change version" action in `list` strips constraint (pin to exact tag)

## Update Strategy

Nuke-and-reinstall: delete manifest `files`, re-clone at same ref, re-copy for same agents. Constrained plugins resolve best match within constraint range.

## Testing

```bash
npm test
```

## Build

```bash
npm build
```

Output: `dist/cli.js`
