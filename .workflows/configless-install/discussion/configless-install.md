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

  Discussion Map — Configless Install (10 subtopics — 7 decided · 3 pending)

  ┌─ ✓ Config Model (Keep+Fallback / Optional-Override / Supersede) [decided]
  ├─ ✓ Structural Type Detection (Bare / Plugin / Collection From Structure) [decided]
  ├─ ✓ Identity & Naming (Dir-Basename Vs Frontmatter `name`) [decided]
  ├─ ✓ Manifest Keying & Lifecycle (Update/Remove For Configless) [decided]
  ├─ ✓ Agent Selection Rework (Installer-Side, KNOWN_AGENTS) [decided]
  ├─ ✓ Multi-Skill Collection Prompt Flow (No Flags, Source Selectors) [decided]
  ├─ ✓ Frontmatter-`name` Collision / Namespacing Policy [decided]
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

### Clarifications (single path; precedence; no config fallback)

Pinned down while resolving the collection flow:

- **One detection path — always structural.** Config is *never* a fallback or a second way to detect type. The config `type` is a single narrow *override input* to the one structurally-ambiguous case (skills-only); it is not a parallel detection mechanism. "Config just becomes config" — `agents` + the optional `type` disambiguator, nothing more.
- **Detection precedence at the root** (resolves "is `skills/` a plugin part or a collection member?"):
  1. root `SKILL.md` → bare skill
  2. root **asset-kind dirs** (`skills/`/`agents/`/`hooks/`) recognised as plugin parts → plugin (with the skills-only→collection exception). *Checked before any member scan*, so `skills/` is never mistaken for "a collection of skills."
  3. otherwise, scan **non-asset-kind child dirs** as potential collection members
  4. else reject
- **Consequence**: `agentic-workflows` (multi-asset: `skills/` + `agents/`/`hooks/`) is a plugin by structure and needs **no** `type: plugin` in config. `type: plugin` is reserved strictly for a *pure skills-only* repo the author wants bundled.

---

## Manifest Keying & Lifecycle

### Context

agntc's value over a one-shot `cp` is *lifecycle* — `update` (nuke-and-reinstall) and `remove`. The user's original pain was a lifecycle failure (un-updatable skills after a lock file broke). Configless must not regress this. The type-detection decision created a specific new hazard: `update` re-clones and re-runs detection, so an install could re-resolve to a *different* type or skill-set than was originally installed.

### Verified current behaviour (code, not memory)

- `ManifestEntry` (`manifest.ts:9`) today carries `ref, commit, installedAt, agents, files, cloneUrl, constraint` — **no `type` field**.
- Manifest is a flat `Record<string, ManifestEntry>`, keyed `owner/repo` (standalone) or `owner/repo/<unit>` (collection member — `add.ts:490,608`).
- **A collection is a transport, not a stored unit**: `runCollectionPipeline` records *each selected child as its own entry*. No collection-level entry exists. (Confirms the user's recollection.)
- **Nested collections already explicitly unsupported** (`add.ts:467` — skipped with a warning), bounding recursion.

### Decision

**Record the resolved type at install time; `update` replays it; never silently morph.**

- **Add a `type` field to `ManifestEntry`**, values `"skill" | "plugin"` only (collection is never stored — its selected children persist as their own skill/plugin entries keyed `owner/repo/<unit>`). However the type was derived — structure, config `type`, or the `--plugin` flag — the *resolved* value is what's persisted. The three derivation paths collapse to one recorded fact.
- **`update` replays the recorded type**, not blind re-detection. Reinstalling the recorded unit re-copies whatever is in the tree now, so benign additions (e.g. the author adds an `agents/` dir to an existing plugin) are picked up *without* changing the recorded type. This is why "adding an agents dir changes nothing" — we're replaying "plugin," not re-deriving it.
- **Derive-before-delete.** On `update`, validate the unit can still be reinstalled as its recorded type *before* removing any existing files. Never delete first and discover failure — that's the exact way the user got stranded before.
- **Irreconcilable change → abort + loud alert, existing install left intact.** If the tree no longer supports the recorded type (unit/path gone, structure incompatible — e.g. was a bare skill, now a collection), do **not** try to save it or auto-migrate. Abort that unit's update, keep what's installed, emit a clear error describing what changed. The user's remedy is manual (`remove` then `add`, their call). Treated as an edge case: correctness and clarity over cleverness.

### Legacy backfill (pre-`type` manifest entries)

Existing manifests predate the `type` field, so the first `update` after this feature has nothing to replay and must derive type once, then fix it into the manifest.

**Decision: backfill via config-aware (v1) derivation, trust it, record it.**

- The whole pre-existing install base is **universally config-bearing** — configless install is net-new, so *no configless legacy install can exist for any user*. Every legacy entry's source repo carries `agntc.json` (or child configs for collection members).
- Therefore legacy type derivation can use the v1 config-gated rule ("config present + asset dirs → plugin; config + root `SKILL.md` → skill"), which **never hits the new skills-only→collection default** — the one case that could flip is structurally unreachable for config-bearing repos.
- Installed *shapes* don't change between install and first update in practice, so the convention/derivation holds. No need to reconcile against the installed `files` as a separate source of truth — the deduction (legacy ⇒ config-bearing ⇒ v1-derivable ⇒ no flip) closes the risk on its own.
- This also covers most of the *Backward-Compat / Migration* subtopic's update concern.

### Keying (resolved by Identity & Naming)

Identity is **dir-basename** (see that subtopic), so manifest keys are unchanged from today: `owner/repo` for a standalone bare skill or plugin, `owner/repo/<unit-dir>` for a collection member. No frontmatter-derived keys. Configless install adds no new keying scheme — it reuses the existing one.

Whether a collection grouping is recorded for bulk `remove` (research noted "unit vs collection granularity") stays a minor open thread — not forced by the keying decision; revisit only if the remove UX needs it.

### Confidence

High — both the lifecycle mechanism (record-type, replay, derive-before-delete, abort-loudly) and the keying (basename, unchanged) are settled.

---

## Identity & Naming

### Context

When agntc installs a configless skill, what name does the installed unit take — the directory basename (today's behaviour) or the `SKILL.md` frontmatter `name` (Vercel's model)? This drives the install folder, the manifest key, dedup, and update-matching.

### Verified current behaviour (code)

`copyBareSkill` (`copy-bare-skill.ts:20,30`) sets the installed folder to `basename(sourceDir)` — the repo name for a bare-skill repo, the subdir name for a nested skill — and **never opens `SKILL.md`**. agntc parses no frontmatter anywhere; detection only checks the file *exists*.

The anchor `refero_skill` makes the divergence concrete: folder/manifest-key would be `refero_skill` (basename) while the SKILL.md self-declares `name: refero-design`.

### Journey

The initial framing leaned toward frontmatter `name` (one source of truth, matches Claude's own skill identity and Vercel). But the user cut through it: **the agent loads a skill by its frontmatter `name`, so the install folder is just storage** — its name is functionally irrelevant to how the skill is invoked. "The repository *is* the skill" for a bare skill, so the repo/directory name is the natural folder name. Whatever the frontmatter calls itself is the skill's own implementation detail, not agntc's concern.

This also dispatched two adjacent questions: agntc does **not** need a YAML-frontmatter parser (nothing reads frontmatter), and it does **not** need Vercel's "validate name+description" gate (the user explicitly doesn't want skill validation). The whole install is a recursive copy of the unit's directory — we keep everything (scripts, references) because we can't know what the skill needs.

### Decision

**Identity = directory basename, throughout. No frontmatter parsing, no validation.**

- Bare skill → installed folder + manifest key = repo name.
- Plugin → install its asset directories; each skill keeps its own repo directory name.
- Collection → pick units; each installs under its repo directory name. Same principle.
- Frontmatter `name` is the skill's business; agntc neither reads nor reconciles it.

**Trade-off accepted**: for third-party repos where repo name ≠ frontmatter name, the on-disk folder and agntc's key differ from what the agent calls the skill (the "three names" situation). Judged immaterial — the agent resolves by frontmatter regardless, and the folder name carries no functional weight. Confidence: high.

---

## Frontmatter-`name` Collision / Namespacing Policy

### Context

If two installed skills declared the same identity, how does agntc namespace/dedup them?

### Decision

**Dissolved by the Identity decision — no frontmatter-name policy needed.**

Because agntc keys on **directory basename**, not frontmatter `name`:

- **agntc-level collisions are directory collisions** — two installs landing in the same `.claude/skills/<name>` path. These are already detected and handled by the existing conflict flow (overwrite/skip prompt). Configless changes nothing here.
- **Agent-level collisions** — two skills in different folders that *self-declare* the same frontmatter `name` — are invisible to agntc and out of scope. That's the skills' own problem (and the agent's), consistent with "frontmatter name is an implementation detail." Noted as an accepted limitation, not a feature to build.

Confidence: high (follows directly from Identity).

---

## Agent Selection Rework

### Context

With config now optional, where does agent selection live, and what happens when there's no author declaration? Research framed this as "the single biggest design consequence." On inspection, most of it is already decided — configless forces only a small mechanical change.

### Prior decisions (verified — code + KB)

The constraint model is **already settled and stays unchanged**:

- **Declared agents are a hard ceiling.** `cursor-agent-driver` decided "filter to declared agents only" — undeclared agents are excluded from the prompt entirely (superseding the earlier "warn, don't block"). Code confirms: `selectAgents` (`agent-select.ts:32`) builds options purely from `declaredAgents`. A Codex user is simply never offered a Claude-only unit for Codex.
- **Auto-select** when a single declared agent is detected (`agent-select.ts:18-26`).
- **Per-plugin silent skip** in collections — undeclared agents are dropped per-plugin during copy, no warning (`cursor-agent-driver` decision).

The user's instinct (hard block) matches the existing decision. Configless does not revisit any of this.

### The one configless delta

`selectAgents` currently returns `[]` when `declaredAgents` is empty (`agent-select.ts:12`) — "install for nobody." Correct under v1 (config mandatory → empty = misconfigured), wrong under configless where "no declaration" is a legitimate, common state meaning **"installable for anything."**

### Decision

**Constraint model unchanged. The only rework: source the candidate list from `KNOWN_AGENTS` when there is no valid author declaration.**

- Valid, non-empty `agents` in config → hard ceiling, exactly as today.
- **No valid constraint → offer all `KNOWN_AGENTS` (claude/codex/cursor), pre-tick detected, user picks.** This replaces the `return []` footgun.
- **"No valid constraint" is unified across three cases — all fall back to the same default:**
  - config **absent** (configless)
  - config present but `agents: []` (empty — "a skill for nothing" makes no sense)
  - config **malformed** (unparseable)

  Rationale: an invalid/unusable `agents` declaration carries no usable author intent, so it's treated identically to no config at all. No hard errors for config problems — `readConfig` treats parse failures as "no usable config" and we fall back to default.

**Trade-off accepted**: a malformed config silently falls back to "all agents" rather than erroring, which could mask an author's typo (their Claude-only intent silently becomes all-agents). Judged acceptable for leniency/simplicity — the installer still chooses, and detection pre-ticks sensibly. Confidence: high.

---

## Multi-Skill Collection Prompt Flow

### Context

A configless collection's children carry no `agntc.json`. But the current collection pipeline (`add.ts`) enumerates installable members *by scanning immediate child dirs for `agntc.json`* — and reads each child's config for its agents too. With no child config, that enumeration has nothing to find. So: what defines "a selectable member" of a configless collection, and how is selection driven (without flags)?

### Decision

**Collection membership = "a child dir that structurally resolves to a unit." Recurse the same structural detection one level down; drive selection with the existing prompt + source-string selector. No flags.**

- For each immediate child dir, run the *same* structural detection: child has `SKILL.md` → bare-skill member; child has asset-kind dirs → plugin member; child has neither → not a member, skip it. The pickable list comes from this structural scan, replacing the "has `agntc.json`" enumeration (resolves the review's F2 — the pipeline's child-config dependency at `add.ts:388,394`).
- **Per-child agents**: child config when present (constrains, per the agent-selection rules) → otherwise the configless default (all `KNOWN_AGENTS`, installer picks). Config-bearing and configless members coexist in one collection.
- **Selection UX is unchanged and flag-free**: the existing `selectCollectionPlugins` interactive prompt for "which member(s)?", plus the source-string selector (`owner/repo@unit`, or a `tree/<branch>/<path>` URL) to pick a member directly without prompting. This is the no-flags resolution research proposed, now confirmed.
- **Nested collections remain unsupported** (`add.ts:467` already skips them) — a collection member that is itself a collection is not recursed into. Membership detection goes exactly one level.

### Confidence

High. This is the structural-detection decision applied one level down — no new concepts, and it removes the child-`agntc.json` dependency that blocked configless collections.

---

## Summary

### Key Insights

*(to be filled as the discussion progresses)*

### Open Threads

*(to be filled as the discussion progresses)*

### Current State

- Nothing decided yet — session just initialized.
