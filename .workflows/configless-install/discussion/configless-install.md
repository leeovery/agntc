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

  Discussion Map — Configless Install (10 subtopics)

  ┌─ ✓ Config Model (Keep+Fallback / Optional-Override / Supersede) [decided]
  ├─ ✓ Structural Type Detection (Bare / Plugin / Collection From Structure) [decided]
  ├─ ✓ Identity & Naming (Dir-Basename Vs Frontmatter `name`) [decided]
  ├─ ✓ Manifest Keying & Lifecycle (Update/Remove For Configless) [decided]
  ├─ ✓ Agent Selection Rework (Installer-Side, KNOWN_AGENTS) [decided]
  ├─ ✓ Multi-Skill Collection Prompt Flow (No Flags, Source Selectors) [decided]
  ├─ ✓ Frontmatter-`name` Collision / Namespacing Policy [decided]
  ├─ ✓ Version Pinning For Untagged Repos [decided]
  ├─ ✓ Copy-Safety Hardening (Recursive Cp Of Untrusted Clone) [decided]
  └─ ✓ Backward-Compat / Migration (Init Scaffolder, Collection Pipeline) [decided]

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
- **Config *presence* never signals type — only an explicit `type` *property* does.** This is the v1 boundary-marker behaviour ("config present → plugin; no root config → collection") staying dead. A config carrying only `agents` has zero effect on type. (Refines the amendment above: config-`type` is kept; config-*presence* as a type signal is not.)
- **`type`/flag resolve only the one ambiguous (skills-only) case; a declared type that contradicts an unambiguous structure is a hard error.** It does real work for skills-only (plugin-bundle vs collection-menu, even with a single skill). But `type: plugin` on a member-dirs collection, `type: plugin` on a bare skill, or `type: collection` on a multi-asset plugin is *unrealizable* — agntc errors rather than forcing an impossible interpretation. Deliberate asymmetry with the agents rule: **missing info → default (lenient); contradictory info → error (loud).**
- **Precedence scope — the ordering `flag > config type > structure` governs *only* the skills-only resolution** (review 002 / F1). There, `--plugin` beats config `type` on disagreement. It does **not** let the flag realize an impossible structure: `--plugin` on a member-dirs collection (or any non-bundleable structure) errors exactly like `type: plugin` would. The flag's only *extra* power is winning the tie in the ambiguous case. "Install every member" is **select-all in the prompt**, not `--plugin`.
- **Source selector and `--plugin` are orthogonal** (review 003 / F3): a selector (`owner/repo@unit`, tree path) chooses *which* unit to install; `--plugin` only resolves the *selected* unit's skills-only ambiguity. So `@unit --plugin` reads as "install `unit`, resolve *its* ambiguity as plugin" — and if `unit` isn't skills-only/bundleable, the type-vs-structure conflict rule errors (agrees = redundant, contradicts = error). No bespoke combination rule: selector = *which*, flag = *how to resolve the selected thing's ambiguity*.

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
- **Member entries replay by path, not by repo re-classification** (review 002 / F6): a collection member persists as `owner/repo/<unit>` with its own recorded type, and `update` re-copies *its own subdir*. A later root-level reshape of the source repo (e.g. skills-only → plugin once the author adds an `agents/` dir) does **not** reach into or retroactively bundle existing member entries — they stay independent units as originally chosen. Only a vanished member subdir trips the abort path above.
- **Per-member abort granularity** (review 002 / F4): `update` operates per manifest entry. A plugin is one entry → atomic (abort = the whole plugin stays). Collection members are **independent entries by construction** — that independence is exactly what makes it a collection and not a plugin — so one member aborting while its siblings advance is correct, *not* a coherence hazard. agntc owes **no** collection-level coherence guarantee (lockstep is what `plugin` is for; there's deliberately no collection record to reason about). Each aborted entry is reported loudly.

### Legacy backfill (pre-`type` manifest entries)

Existing manifests predate the `type` field, so the first `update` after this feature has nothing to replay and must establish a type once, then fix it into the manifest.

**Decision: backfill `type` from the recorded `files` (the local install is ground truth) — not from a fresh re-clone or re-detection.** (Revised per review 003 / F1.)

- An initial framing proposed a config-aware (v1) derivation on the re-cloned remote, reasoning that all legacy installs are config-bearing (configless is net-new). **That breaks at the time gap**: backfill runs at the first `update`, which re-clones the *current* remote — and an author may have dropped `agntc.json` by then (the exact configless migration this feature enables). A shape-unchanged but now config-absent skills-only repo would re-derive as `collection`, silently flipping a `plugin` install — the morph the lifecycle rules forbid. Config-presence, not shape, was the load-bearing assumption, and config-presence is precisely what this feature encourages authors to change.
- **The local install is the authoritative record of what was installed.** The manifest entry's `files` already encode the type: an entry that wrote to `agents/`/`hooks/` targets, or holds multiple skill dirs under one key → `plugin`; a single `.claude/skills/<name>/` → bare skill. Backfill reads `files`, records `type`, and is therefore **immune to any drift in the remote's current config or shape**. `update` preserves the identity of *what the user installed*, not a re-interpretation of a remote that may have changed underneath them.
- **Backfill is per manifest entry, and an entry is always a unit (skill/plugin) — never a collection** (review 002 / F3). Collections are transport-only and never stored. A legacy collection-member entry (`owner/repo/<unit>`) backfills from its own `files` like any other unit. No collection type is ever derived or stored — the member sub-case is just "backfill each unit entry," not "re-derive the set."
- This also covers the *Backward-Compat / Migration* subtopic's update concern.

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

## Version Pinning For Untagged Repos

### Context

agntc's version model is tag/semver-based, added after launch (originally it only tracked a branch HEAD). A configless repo like `refero_skill` has **zero tags** — so what ref/constraint does it pin to, and how does `update` behave with no semver anchor?

### Verified current behaviour (code)

The tagless case is **already handled** — configless doesn't introduce it:

- Bare `owner/repo` install: `resolveLatestVersion(tags)` (`add.ts:60`) returns `null` when there are no tags, so the `ref = latest.tag` assignment is skipped. The entry lands as `ref: null`, `commit: <SHA>`, **no constraint**.
- `checkForUpdate` (`update-check.ts:71`) sees `ref === null` → routes to **`checkHead`**, a SHA-diff against the remote default-branch HEAD. So a tagless repo already *tracks HEAD and stays updatable*.
- Tagged repos: `^major.minor.patch` auto-constraint, npm/Composer-style — minor/patch auto-apply, `0.x` and out-of-range majors shown but require explicit bump. Unchanged.

### Decision

**Reuse the existing tagless→HEAD tracking unchanged; `ref: null` is the canonical tagless representation.**

- Untagged install (including every configless tagless repo) → `ref: null`, `commit: <SHA>`, no constraint → `update` routes to `checkHead`, SHA-diffing the remote's default-branch HEAD. Mechanism already exists; configless flows through the identical path — **no new code**.
- **No branch-name polish** (revised per review 003 / F2). Recording the default-branch *name* as `ref` (→ `checkBranch`) was considered for `list` visibility but **rejected**: (a) it bifurcates the manifest — new tagless entries `ref: <branch>` vs legacy `ref: null` — two shapes for one concept; (b) `checkBranch` *pins a named branch* that breaks on a default-branch rename (`master`→`main`), whereas `checkHead` follows the symbolic default HEAD and is **more robust**. `ref: null` is **not vestigial**: `ref` records *user intent* (tag / branch / none), and `null` = "no explicit ref → follow default HEAD," comparing by the stored `commit`. (Confirmed against `version-constraints` history — this was a deliberate prior decision.)
- If `list` wants to show the branch name, **resolve it at display time** — do not store it.
- Explicit `#ref` / `@tag` still pin exactly as today.

**Trade-off accepted**: branch-tracking has no semver gate, so "latest" could ship a breaking change — but the author published no versions to gate on, and the SHA move is visible in `list`/`update` before it's applied. Confidence: high.

---

## Copy-Safety Hardening

### Context

A *pre-existing* exposure that configless **widens, not creates**. `cloneSource` (`git-clone.ts`) does `git clone --depth 1` with no size cap and no symlink handling; `copyBareSkill` (`copy-bare-skill.ts:32`) does `cp(sourceDir, destDir, { recursive: true })` of the whole clone, then deletes `agntc.json`. agntc already copies untrusted repo contents today — the *only* current trust gate is "the repo shipped an `agntc.json`," and configless removes exactly that gate, so the input becomes genuinely arbitrary third-party repos.

The Identity decision keeps the copy mechanism itself (recursive `cp`, keep everything — we can't know what a skill needs). So this is about not letting a repo read/write *outside* the directory it's meant to land in — distinct from skill *validation*, which the user explicitly doesn't want.

### Decision

**Fold the cheap boundary-level floor into this feature; defer deeper hardening to a logged idea.**

In scope for configless-install:
1. **Path-traversal guard** — validate any source-supplied subpath/selector (`@unit`, tree path, `#ref@skill`) resolves *within* the clone before copying. Mirrors Vercel's `isSubpathSafe`. Cheapest, highest value.
2. **Symlink-escape guard** — `cp` runs with `dereference: false`, so repo symlinks land verbatim; reject any symlink that doesn't resolve inside the unit's own directory.

**Guard scope** (review 002 / F5): the two guards are *complementary*. Path-traversal protects **source resolution** (selectors/subpaths — where we copy *from*) and is a no-op for a no-selector whole-repo copy like the `refero_skill` bare-skill case. The symlink guard protects **copied content** (what lands on disk) and runs on *every* install, bare skills included. So the headline bare-skill case is covered by the symlink guard; path-traversal simply has nothing to check there.

**Guard timing** (review 002 / F2): both guards run as a **pre-flight scan of the unit tree *before* any copy**. Walk the tree, validate selectors resolve within the clone and no symlink escapes the unit dir; on violation, **error before writing anything**. The single recursive `cp` (Identity decision) then runs only on a verified-clean tree. Pre-flight (not post-copy scan-and-remove) leaves no on-disk window where escaping symlinks exist, and matches the derive-before-delete principle: validate before you mutate.

Deferred into a general **validation** inbox idea (`.inbox/ideas/2026-06-05--validation.md`) — which also collects other validation concerns surfaced here (skill-validity gate, untrusted-frontmatter parsing safety, config-schema validation depth, agent-level identity collisions):
3. Tree size / file-count / depth caps.
4. Executable / hook safety (a configless plugin's `hooks/` = code that runs on the agent's next invocation).

Rationale: #1 and #2 are the true security boundary (escape prevention) and are cheap; configless is precisely what makes the input untrusted, so they belong here. #3 and #4 are broader hardening that applies to agntc's copy path regardless of configless — better discussed on their own than bolted on.

Confidence: high.

---

## Backward-Compat / Migration

### Context

The model changes (structure-authoritative type, config demoted, configless installs) ripple across existing installs, the `init` scaffolder, the config schema, and the collection pipeline. Most resolved while deciding other subtopics; this collects the remainder (review F1, F9).

### Decision

- **Existing installs** — covered by *legacy backfill* (Manifest Keying & Lifecycle): first `update` of a pre-`type` entry derives type once **from the recorded `files`** (local install = ground truth) and records it. Immune to the remote dropping config or reshaping between install and first update. No separate migration step.
- **`init` scaffolder stays agents-only.** Every path it offers (skill / plugin / collection) scaffolds a *structurally unambiguous* layout, so it never needs to emit `type`. `type` remains a hand-authored field for the rare skills-only bundle. (`init` is unchanged by this feature.)
- **Config schema** — `{ agents, type? }`. **Unknown keys are ignored** (lenient), so older/newer agntc versions don't choke on each other's configs.
- **Config *presence* is no longer a type signal** (see Structural Type Detection clarifications) — only an explicit `type` property is read. This is the v1 boundary-marker behaviour staying removed.
- **Collection with a stray root `agntc.json`** (review F9): structure decides it's a collection regardless. Root config with **no `type`** → ignored. Root config declaring **`type: plugin`** on a member-dirs structure → **hard error** (unrealizable, per the type-vs-structure conflict rule). Presence alone never reclassifies it.
- **Collection pipeline's child-`agntc.json` dependency** (research, `add.ts:388,394`) — resolved by *Multi-Skill Collection Prompt Flow*: membership comes from structural detection per child; child config is read only for agents when present.

### Confidence

High. No standalone migration tooling needed — backfill + lenient schema + structure-authoritative detection cover the surface.

---

## Summary

### Key Insights

1. **Config's only irreducible job is author agent-restriction.** Type, identity, and installability are structural. This extends v1's `config-file-simplification` — but goes further: config *presence* no longer signals type at all; only an explicit `type` property is read, and only to disambiguate one case.
2. **The single hard problem configless creates is the skills-only repo.** A root `skills/` dir is structurally ambiguous because agntc (plugin = install-as-one) and Vercel (menu = pick each) assign it opposite meanings. Resolved by: default → collection/menu (Vercel-compatible, the common third-party path), with two overrides — author `type: plugin` and installer `--plugin`.
3. **Detection is the small part; integration is the weight** — and most of it reuses machinery agntc already has: tagless→HEAD tracking, the agent hard-ceiling, collection-as-transport keying, dir-basename identity, the conflict-prompt for dir collisions.
4. **Lifecycle safety is the spine** (the user's original pain): record the resolved type, *replay* it on `update` rather than re-detect, derive-before-delete, and abort loudly on irreconcilable change — never silently morph an install's type.
5. **"Missing info → lenient default; contradictory info → loud error"** emerged as a consistent posture (empty/malformed config → all agents; declared type vs structure mismatch → error).

### Open Threads

- **Validation** (skill-validity gate, untrusted-frontmatter parsing safety, tree/file/hook limits, config-schema depth, agent-level frontmatter-`name` collisions) — deferred to `.inbox/ideas/2026-06-05--validation.md` for a separate discussion.
- **Collection grouping for bulk `remove`** — minor; revisit only if the remove UX calls for it.
- **Ecosystem directions out of scope** (research Findings 4 + expanded surface): `.well-known` skill indices, hosted registry (`skills.sh`), and new verbs (`use`/`find`/`check`) — candidates to log separately, not part of this feature.

### Current State

All 10 subtopics decided. Feature shape: structural type detection (with the skills-only override pair); config = `{ agents, type? }` where presence ≠ type-signal and a type-vs-structure conflict errors; dir-basename identity (no frontmatter parsing); record-type lifecycle (replay, derive-before-delete, abort-loudly) with `files`-derived legacy backfill; installer-side agent selection over `KNOWN_AGENTS` with the declared-agents hard ceiling; structural collection membership + flag-free selection; tagless tracking via canonical `ref: null`/`checkHead` (branch-name resolved at display time, not stored); copy-safety floor (path-traversal + symlink-escape guards) with deeper hardening deferred to the validation idea.
