---
topic: naming-and-identity
status: concluded
date: 2026-02-09
---

# Discussion: Naming and Identity

## Context

The tool needed a name. Original placeholder "agentic" was taken on npm (squatted, 0.0.2). Explored a wide range of alternatives across themes: knowledge insertion, neuroscience, education, Greek/Latin roots, and compressed developer shorthand.

### References

- [Research: exploration.md — Naming Exploration](../research/exploration.md) (lines 382-409)

## Questions

- [x] What should the final name be?
- [x] Does the name propagate cleanly to all touchpoints?

---

## What should the final name be?

### Context

Need an npm-available name that's dev-friendly, memorable, and reflects the tool's purpose of injecting knowledge/skills into agents.

### Options Considered

**`agntc`**
- Developer shorthand for "agentic" — compressed, no vowels
- Follows dev tool convention (`pnpm`, `tmux`, `rg`)
- `npx agntc add owner/repo` reads clean
- npm available (now obtained)

**`noesis`**
- Greek: "the act of knowing" — conceptually strong
- Less immediately obvious what it does

**`imbuo`**
- Latin root of "imbue" — to saturate/instill
- Obscure, harder to remember

**`skillpak`**
- Practical and clear
- More descriptive but less distinctive

### Decision

**`agntc`**. Already obtained on npm. Compressed no-vowel style is idiomatic for dev tools. Immediately evokes "agentic" which describes the domain. Clean across all surfaces.

---

## Does the name propagate cleanly to all touchpoints?

### Context

The name appears across multiple surfaces — needs to work ergonomically everywhere.

### Touchpoints

| Surface | Form | Example |
|---------|------|---------|
| CLI | `agntc` | `npx agntc add owner/repo` |
| npm package | `agntc` | `npm install agntc` |
| Plugin config | `agntc.json` | In plugin repos, declares compatibility |
| Manifest dir | `.agntc/` | In consumer repos, tracks installs |

### Decision

All clean. Consistent compressed form across every touchpoint — no awkward expansions. Mirrors conventions like `tsconfig.json`, `.npmrc`. The only tradeoff is discoverability — users might mistype as `agentic` — but that's inherent to compressed names and accepted.

---

## Summary

### Key Insights
1. `agntc` won on ergonomics — compressed, dev-idiomatic, immediately evokes the domain
2. Name propagates cleanly to all touchpoints without special casing

### Current State
- Name confirmed and npm package obtained
- No open questions

### Next Steps
- None — naming is resolved
