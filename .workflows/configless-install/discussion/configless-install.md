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

  Discussion Map — Configless Install (10 subtopics — 1 decided · 1 exploring · 8 pending)

  ┌─ ✓ Config Model (Keep+Fallback / Optional-Override / Supersede) [decided]
  ├─ ◐ Structural Type Detection (Bare / Plugin / Collection From Structure) [exploring]
  ├─ ○ Identity & Naming (Dir-Basename Vs Frontmatter `name`) [pending]
  ├─ ○ Manifest Keying & Lifecycle (Update/Remove For Configless) [pending]
  ├─ ○ Agent Selection Rework (Installer-Side, KNOWN_AGENTS) [pending]
  ├─ ○ Multi-Skill Collection Prompt Flow (No Flags, Source Selectors) [pending]
  ├─ ○ Frontmatter-`name` Collision / Namespacing Policy [pending]
  ├─ ○ Version Pinning For Untagged Repos [pending]
  ├─ ○ Copy-Safety Hardening (Recursive Cp Of Untrusted Clone) [pending]
  └─ ○ Backward-Compat / Migration (Init Scaffolder, Collection Pipeline) [pending]

---

*Subtopics are documented below as they reach `decided` or accumulate enough exploration to capture.*

---

## Config Model

### Context

The keystone decision: of research's three synthesis options — (1) keep `agntc.json`, add a configless fallback; (2) optional-everywhere, config is pure override; (3) supersede `agntc.json` entirely — which model does configless install adopt? Everything downstream (identity, agent selection, lifecycle, detection) inherits from this.

### Options Considered

**Option 1 — keep + fallback**: configured repos behave as today; unconfigured fall back to structure detection. Two code paths, two mental models.

**Option 2 — optional-override**: always detect from structure; `agntc.json` when present only *overrides* (e.g. pins agents). One path, config is pure override.

**Option 3 — supersede entirely**: drop config; structure + install-time agent selection is the whole model. Simplest, but loses author-declared agent targeting.

### Journey

Research leaned toward option 2 and the user's captured direction matched ("config optional, present-only-constrains"). But on close reading, options 2 and 3 are *identical for the simple case* — a bare-`SKILL.md` repo behaves the same under both. They only diverge when config is present. So the real question narrowed to: **when config IS present, what does it still control?**

The user resolved this decisively by reframing, not picking from the menu. The intent is a **clean split of responsibilities**:

- **Type, identity, installability → derived from directory structure ALONE.** Never config, never flags. This is option 3's stance for *shape*.
- **Agent targeting → optional author override via config.** Absent → installer picks from the predefined agent list (claude/codex/cursor); the unit is installable for anything. Present → author has restricted the targets; agntc honours them. This is option 2's stance for *agents only*.

The critical correction this produced: config is **no longer what makes a repo installable, and no longer what determines its type**. Today, detection leans on config (root config → plugin; child configs → collection). Under this model, config is demoted to a single job — author-side agent restriction — and is removed from the type/identity question entirely. The three types (bare skill, plugin, collection) must therefore be separable from structure alone (see *Structural Type Detection*).

Config, when present, lives *inside an installable unit* — a bare skill, a plugin, or each unit within a collection. A **collection is not an installable unit** (it's a container of units), so a collection container never carries config.

The `agentic-workflows` repo (the user's own: `skills/`+`agents/`, Claude-only) is no longer the argument for "config earns its keep on grouping" — its grouping (plugin = one unit) must now come from *structure*, and its config survives only to express "Claude-only." `refero_skill` (bare `SKILL.md`, no config) is installable for any agent the installer picks.

### Decision

**A hybrid: structure is the sole authority for type/identity/installability; `agntc.json` is an optional, per-unit, agents-only override.**

- No config → unit installable for all agents; installer chooses at install time from the predefined list (claude/codex/cursor).
- Config present (inside a bare skill, a plugin, or a collection member) → author has constrained target agents; agntc honours that list.
- Collections never carry config (not a unit).
- No install-command flags for type or selection. Unit selection from a collection is via interactive prompt (already supported) or a source-string selector (repo + unit appended).

**Trade-off accepted**: walks back the v1 "config means I am installable" rule wholesale for the type/installability dimension, while preserving author agent-targeting for those who want it. Confidence: high — the user articulated this as a settled mental model, not a tentative lean.

**Consequence that becomes the next subtopic**: type detection must now be fully structural — the hard part this model creates.

---

## Summary

### Key Insights

*(to be filled as the discussion progresses)*

### Open Threads

*(to be filled as the discussion progresses)*

### Current State

- Nothing decided yet — session just initialized.
