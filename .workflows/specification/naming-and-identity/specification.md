---
topic: naming-and-identity
status: concluded
type: cross-cutting
date: 2026-02-12
sources:
  - name: naming-and-identity
    status: incorporated
---

# Specification: Naming and Identity

## Specification

## Name

**`agntc`** — compressed "agentic" with vowels removed.

- Follows dev tool naming conventions (`pnpm`, `tmux`, `rg`)
- npm package obtained
- Immediately evokes "agentic", describing the domain
- Tradeoff: users may mistype as "agentic" — accepted as inherent to compressed names

## Touchpoints

The name takes a consistent form across all surfaces — no expansions or special casing.

| Surface | Form | Example |
|---------|------|---------|
| CLI command | `agntc` | `npx agntc add owner/repo` |
| npm registry | `agntc` | Published package enabling `npx` usage |
| Plugin config file | `agntc.json` | Declares plugin compatibility in plugin repos |
| Manifest directory | `.agntc/` | Tracks installs in consumer repos |

## Dependencies

None. This is a cross-cutting naming decision with no implementation prerequisites. Other specifications reference this name as a given.
