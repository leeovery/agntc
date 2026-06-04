# Discussion: Configless Install

## Context

Let agntc install any skill or collection from an arbitrary GitHub repo without requiring an `agntc.json` — auto-detecting repo shape, treating `agntc.json` as optional (and when present, present-only-constrains), with disambiguation done through prompts and source-string selectors rather than flags.

Research established the feature is technically feasible (Vercel `skills` is an existence proof) and that **detection is the small part** — the weight is in integration: identity/naming, manifest keying & lifecycle, agent-selection rework, version pinning for untagged repos, and copy-safety. Truly configless install does not exist today: every installable unit still requires an `agntc.json` (`add.ts:193` rejects a bare-`SKILL.md` repo as `not-agntc`). The anchor case `referodesign/refero_skill` (root `SKILL.md`, no config, zero tags, frontmatter `name: refero-design` ≠ basename `refero_skill`) concretely surfaces three of the hard sub-decisions in one repo.

This discussion resolves the parked decisions; research deliberately surfaced trade-offs without picking.

### References

- [Research: Configless Install](../research/configless-install.md)
- Anchor repo: `referodesign/refero_skill` (bare skill, no config, untagged)
- Counterweight repo: `agentic-workflows` (root `agntc.json: {agents:[claude]}`, plugin — config earns its keep)

## Discussion Map

### States

- **pending** (`○`) — identified but not yet explored
- **exploring** (`◐`) — actively being discussed
- **converging** (`→`) — narrowing toward a decision
- **decided** (`✓`) — decision reached with rationale documented

### Map

  Discussion Map — Configless Install (10 subtopics · 10 pending)

  ┌─ ○ Config model (keep+fallback / optional-override / supersede) [pending]
  ├─ ○ Detection extension (bare SKILL.md + SKILL.md-keyed collection) [pending]
  ├─ ○ Identity & naming (dir-basename vs frontmatter `name`) [pending]
  ├─ ○ Manifest keying & lifecycle (update/remove for configless) [pending]
  ├─ ○ Agent selection rework (installer-side, KNOWN_AGENTS) [pending]
  ├─ ○ Multi-skill collection prompt flow (no flags, source selectors) [pending]
  ├─ ○ Frontmatter-`name` collision / namespacing policy [pending]
  ├─ ○ Version pinning for untagged repos [pending]
  ├─ ○ Copy-safety hardening (recursive cp of untrusted clone) [pending]
  └─ ○ Backward-compat / migration (init scaffolder, collection pipeline) [pending]

---

*Subtopics are documented below as they reach `decided` or accumulate enough exploration to capture.*

---

## Summary

### Key Insights

*(to be filled as the discussion progresses)*

### Open Threads

*(to be filled as the discussion progresses)*

### Current State

- Nothing decided yet — session just initialized.
