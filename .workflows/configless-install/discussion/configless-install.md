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

  Discussion Map — Configless Install (10 subtopics — 2 decided · 8 pending)

  ┌─ ✓ Config Model (Keep+Fallback / Optional-Override / Supersede) [decided]
  ├─ ✓ Structural Type Detection (Bare / Plugin / Collection From Structure) [decided]
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

### Amendment — config regains an optional `type`; flags admitted as narrow overrides

The "structure is the *sole* authority, config is agents-only, no flags ever" form did not survive contact with the *Structural Type Detection* subtopic. The skills-only-repo case proved genuinely undecidable from structure (see that section), so the model is refined — not reversed:

- **Config is `agents` + an optional `type`.** `type` returns as an author-side *disambiguator* for the one case structure can't express (skills-only → bundle vs menu). This is consistent in spirit with v1's removal of `type`: v1 dropped it because, *with config mandatory*, structure + config-presence already disambiguated; configless removes that precondition (see `v1/config-file-simplification`, rules at lines 195–202 are config-gated), so `type` re-earns its place as irreducible author intent — same category as `agents`.
- **Install-time flag admitted as a narrow installer-side override** (`--plugin` to force-bundle a configless repo that would default to menu). This is a deliberate, scoped exception to the documented no-flags principle — justified because the ambiguity cannot be solved magically and the *installer* (not just the author) needs a lever for third-party repos they don't control.
- **Precedence**: install flag > config `type` > structural default.

Net config shape: `{ "agents": [...], "type"?: "plugin" }`. Still optional, still per-unit, still never on a collection container.

---

## Structural Type Detection

### Context

The config-model decision made structure the default authority for type. But agntc has a concept Vercel lacks — the **plugin** (an atomic, install-as-one bundle) — and that concept collides with the dominant ecosystem's conventions once config is removed. This subtopic defines how bare-skill / plugin / collection are told apart from structure alone, and how the one irreducibly-ambiguous case is resolved.

### The collision (the crux)

`agentic-workflows` is the *reason agntc exists*: under Vercel's `skills` CLI you must select every skill individually, but a coherent workflow system breaks if one skill is missing — it must install as a whole (a plugin). agntc was built to express exactly that.

But research (Finding 1, verified against Vercel source) confirmed: **Vercel's `discoverSkills` treats a root `skills/` dir as a menu** — it walks one level in and returns *every* `SKILL.md` as an independently-installable skill. Vercel has **no atomic-bundle concept at all**. So a root `skills/` dir means opposite things in the two ecosystems: "one plugin" (agntc author intent) vs "a menu of N" (Vercel, and therefore most third-party repos).

Structure alone cannot resolve this, because the two ecosystems assign the *same shape* opposite meanings.

### Where the ambiguity actually lives (narrowed)

Only **one** shape is ambiguous; the rest are clean:

| Structure | Type | Ambiguous? |
|---|---|---|
| `SKILL.md` at root | bare skill | no |
| `skills/` **+** (`agents/` or `hooks/`) | plugin | no — Vercel has no multi-asset shape; `agentic-workflows` lands here |
| named member dirs, each a unit (`SKILL.md` or its own `skills/`) | collection | no |
| **`skills/`-only at root** | **plugin or collection?** | **yes — the only ambiguous case** |
| nothing reachable | not-agntc (reject) | no |

### Options Considered (for the ambiguous case)

**Option A — default skills-only → plugin** (user's initial structural rule). Matches "skills/ = a plugin." Cost: every third-party Vercel *menu* repo force-bundles unless overridden — friction on the feature's primary use case (installing third-party repos).

**Option B — default skills-only → collection/menu** (Vercel-compatible). Cost: inverts the structural rule; an authored skills-only *plugin* must declare itself.

**Option C — asset-kind-count heuristic** (skills-only = collection, skills+other = plugin, no overrides). Rejected earlier: it removes the author's ability to ship a skills-only bundle entirely, and the user's whole motivation is being able to ship a bundle.

### Journey

Initial instinct was Option A (the literal structural rule). It broke against the feature's purpose: configless install exists *for third-party repos*, which are overwhelmingly Vercel-convention, where `skills/` means a menu. Defaulting to plugin would force-bundle the common case and demand a flag every time.

The unlock was realising the two actors need two different levers, and that **"configless" is itself a strong signal of "third-party / Vercel-convention"**:

- The user's *own* plugins are never really configless — they carry `agntc.json` anyway (Claude-only), so they can declare `type: plugin` and bundle with zero friction.
- A *configless* skills-only repo is almost certainly third-party Vercel content → menu is the right default.

So the default flips to **collection for configless skills-only**, and the bundle intent is carried by config (`type: plugin`) for authors. The user then surfaced a real installer-side case the config lever can't cover: a third-party Vercel menu repo where *they* want everything installed as one unit without hand-selecting. That's the justification for an install-time `--plugin` flag — an installer override, distinct from the author override.

Both overrides admitted deliberately, despite the no-flags / no-type principles, because the ambiguity is irreducible and each actor needs their own escape hatch.

### Decision

**Structural defaults, with a two-level override.**

Detection (in precedence order):
1. **Install flag** (`--plugin`) → force the source to install as one atomic bundle. Highest precedence.
2. **Config `type`** (when `agntc.json` present and declares it) → author's call.
3. **Structure** (default):
   - `SKILL.md` at root → **bare skill**
   - `skills/` + (`agents/`/`hooks/`) → **plugin** (atomic)
   - named member dirs, each a unit → **collection** (pick one/some/all)
   - **`skills/`-only at root → collection (menu)** — Vercel-compatible default
   - nothing reachable → reject as not-agntc

Rationale: the common third-party path (Vercel menu repos) works flag-free and correctly; the user's own bundles work via config; the rare "force-bundle a configless menu" case is a one-flag override.

**Trade-offs accepted**: re-admits a `type` config field (deliberately removed in v1) and one install flag (against the documented no-flags principle) — both scoped strictly to resolving the skills-only ambiguity, justified because structure provably can't. Confidence: high.

**Open for the next subtopic**: making `update`/`remove` *replay the resolved type* rather than re-detect (so a default or a repo-shape change can't silently flip an install's type — the user's original lifecycle pain).

---

## Summary

### Key Insights

*(to be filled as the discussion progresses)*

### Open Threads

*(to be filled as the discussion progresses)*

### Current State

- Nothing decided yet — session just initialized.
