# Specification: Configless Install

## Specification

## Overview

### Goal

Let agntc install any skill, plugin, or collection from an arbitrary git repository **without requiring an `agntc.json`**. The repo's directory structure becomes the sole authority for *type*, *identity*, and *installability*. `agntc.json` becomes optional and, when present, carries only author-side agent restriction plus an optional `type` disambiguator — its *presence* never signals type.

### Problem

Truly configless install does not exist today: every installable unit still requires an `agntc.json`. A bare-`SKILL.md` repo is rejected as `not-agntc`. The anchor case `referodesign/refero_skill` (root `SKILL.md`, no config, zero tags, frontmatter `name: refero-design` ≠ basename `refero_skill`) surfaces three of the hard sub-problems in one repo: structural type detection, identity, and version pinning for an untagged repo.

### Scope framing

Detection is the small part; the weight is integration: identity/naming, manifest keying & lifecycle, agent-selection rework, version pinning for untagged repos, and copy-safety. Most of the integration **reuses machinery agntc already has** — tagless→HEAD tracking, the agent hard-ceiling, collection-as-transport keying, dir-basename identity, and the conflict-prompt for directory collisions.

### Governing posture

A consistent rule runs through the whole feature: **missing info → lenient default; contradictory info → loud error.** (Empty/malformed config falls back to all agents; a declared type that contradicts an unambiguous structure is a hard error.)

### Anchor cases

- **`referodesign/refero_skill`** — bare `SKILL.md`, no config, untagged. The configless headline case.
- **`agentic-workflows`** — `skills/` + `agents/`/`hooks/`, ships `agntc.json: {agents:[claude]}` (Claude-only). A plugin *by structure*; its config survives only to express "Claude-only."

---

## Config Model

A clean split of responsibilities replaces v1's "config means I am installable" rule.

### Responsibility split

- **Type, identity, and installability → derived from directory structure ALONE.** Never from config, never from config *presence*.
- **Agent targeting → optional author override via config.** Absent → installer picks from the predefined agent list at install time; the unit is installable for any agent. Present → author has restricted the targets; agntc honours that list.

### Config shape

`agntc.json` is `{ "agents": [...], "type"?: "plugin" }`:

- **`agents`** (optional) — author-side restriction of target agents. A hard ceiling when valid and non-empty (see *Agent Selection*).
- **`type`** (optional) — author-side disambiguator for the single structurally-ambiguous case only (skills-only repo → bundle vs menu). Reserved strictly for a pure skills-only repo the author wants bundled as a plugin. See *Structural Type Detection*.

### Rules

- **Config is optional and per-unit.** It lives *inside* an installable unit — a bare skill, a plugin, or each member of a collection.
- **A collection is not an installable unit** (it's a container of units), so a collection container **never carries config**.
- **Config *presence* never signals type.** Only an explicit `type` *property* is read, and only to disambiguate the skills-only case. A config carrying only `agents` has zero effect on type. (The v1 "config present → plugin; no root config → collection" boundary-marker behaviour stays dead.)
- **Unknown config keys are ignored** (lenient) — older/newer agntc versions don't choke on each other's configs.
- **No install-command flags for type or unit selection**, except the single narrow `--plugin` installer override defined in *Structural Type Detection*. Unit selection from a collection is via interactive prompt or a source-string selector.

### Rationale

Config is demoted to two narrow, irreducible jobs: author agent-restriction (`agents`) and author bundle-intent for the one ambiguous shape (`type`). Both are genuine author intent that structure cannot express. Everything else about a repo is read from its structure.

---

## Structural Type Detection

Type is detected from structure alone, by a single detection path, with a two-level override resolving the one irreducibly-ambiguous shape.

### The four structural shapes

| Structure | Type | Ambiguous? |
|---|---|---|
| `SKILL.md` at root | bare skill | no |
| `skills/` **+** (`agents/` or `hooks/`) | plugin (atomic) | no — Vercel has no multi-asset shape; `agentic-workflows` lands here |
| named member dirs, each a unit (`SKILL.md` or its own `skills/`) | collection | no |
| **`skills/`-only at root** | **plugin or collection** | **yes — the only ambiguous case** |
| nothing reachable | not-agntc (reject) | no |

### Why skills-only is ambiguous

A root `skills/` dir means opposite things in the two ecosystems: "one plugin / install-as-one" (agntc author intent) vs "a menu of N independently-installable skills" (Vercel convention, and therefore most third-party repos). Structure alone cannot resolve it because the same shape carries opposite meanings. Vercel's `discoverSkills` walks one level into a root `skills/` dir and returns every `SKILL.md` as independently installable — it has no atomic-bundle concept at all.

### Detection precedence (resolution order)

1. **Install flag `--plugin`** — force the *selected* source to install as one atomic bundle. Highest precedence.
2. **Config `type`** (when `agntc.json` present and declares it) — author's call.
3. **Structure** (default).

### Single structural detection path (at the root)

There is **one** detection path and it is always structural. Config `type` and `--plugin` are *override inputs* to the ambiguous case only — never a parallel or fallback detection mechanism.

1. root `SKILL.md` → **bare skill**
2. root **asset-kind dirs** (`skills/` / `agents/` / `hooks/`) recognised as plugin parts → **plugin** — *checked before any member scan*, so `skills/` is never mistaken for "a collection of skills." Exception: `skills/`-only (no `agents/`/`hooks/`) → falls to the skills-only ambiguous case.
3. otherwise, scan **non-asset-kind child dirs** as potential collection members → **collection**
4. else **reject** as not-agntc

### Skills-only resolution (the ambiguous case)

- **Default → collection (menu)** — Vercel-compatible, the common third-party path. Works flag-free.
- **Author override** → config `type: plugin` bundles it (even a single skill).
- **Installer override** → `--plugin` flag bundles it.
- On disagreement between the two overrides in this case, **`--plugin` beats config `type`** (precedence above).

### Type-vs-structure conflict → hard error

`type`/`--plugin` resolve **only** the skills-only case. A declared type (or flag) that contradicts an *unambiguous* structure is **unrealizable → hard error**, not a forced interpretation:

- `type: plugin` on a member-dirs collection → error.
- `type: plugin` on a bare skill → error.
- `type: collection` on a multi-asset plugin → error.
- `--plugin` on a member-dirs collection (or any non-bundleable structure) → error, exactly as `type: plugin` would. The flag's *only* extra power is winning the tie in the ambiguous case — it cannot realize an impossible structure.

This is the deliberate asymmetry of the governing posture: **missing info → default (lenient); contradictory info → error (loud).**

### Selector / `--plugin` orthogonality

A source selector (`owner/repo@unit`, tree path) and `--plugin` are orthogonal axes:

- **Selector = *which* unit** to install.
- **`--plugin` = *how to resolve the selected unit's* skills-only ambiguity.**

So `@unit --plugin` reads as "install `unit`, resolve *its* ambiguity as plugin." If the selected `unit` isn't skills-only/bundleable, the type-vs-structure conflict rule applies (agrees → redundant/no-op; contradicts → error). There is no bespoke selector+flag combination rule.

### Consequences

- `agentic-workflows` (multi-asset: `skills/` + `agents/`/`hooks/`) is a plugin by structure and needs **no** `type: plugin`. `type: plugin` is reserved strictly for a pure skills-only repo the author wants bundled.
- The resolved type — however derived (structure, config `type`, or `--plugin`) — is what gets recorded in the manifest (see *Manifest Keying & Lifecycle*).

---

## Identity & Naming

### Decision

**Identity = directory basename, throughout. No frontmatter parsing, no validation.**

- **Bare skill** → installed folder + manifest key = repo name (the directory basename).
- **Plugin** → install its asset directories; each skill keeps its own repo directory name.
- **Collection** → pick units; each installs under its repo directory name. Same principle.
- Frontmatter `name` is the skill's own business; agntc neither reads nor reconciles it.

### Rationale

The agent loads a skill by its frontmatter `name`, so the install folder is just storage — its name is functionally irrelevant to how the skill is invoked. For a bare skill, "the repository *is* the skill," so the repo/directory name is the natural folder name. Whatever the frontmatter calls itself is the skill's own implementation detail, not agntc's concern.

### Consequences

- **agntc needs no YAML-frontmatter parser** — nothing reads frontmatter; detection only checks that `SKILL.md` *exists*.
- **agntc needs no name+description validation gate** (Vercel's model) — skill validation is explicitly out of scope.
- **The install is a recursive copy of the unit's directory** — keep everything (scripts, references); agntc can't know what the skill needs.

### Trade-off accepted

For third-party repos where repo name ≠ frontmatter name (e.g. `refero_skill` on disk, `name: refero-design` in frontmatter), the on-disk folder and agntc's manifest key differ from what the agent calls the skill (the "three names" situation). Judged immaterial — the agent resolves by frontmatter regardless, and the folder name carries no functional weight.

### Frontmatter-name collisions (dissolved)

Because agntc keys on directory basename, no frontmatter-name namespacing policy is needed:

- **agntc-level collisions are directory collisions** — two installs landing in the same `.claude/skills/<name>` path. Already detected and handled by the existing conflict flow (overwrite/skip prompt). Configless changes nothing here.
- **Agent-level collisions** — two skills in different folders that self-declare the same frontmatter `name` — are invisible to agntc and **out of scope**. That's the skills' (and the agent's) problem. Accepted limitation, not a feature to build.

---

## Manifest Keying & Lifecycle

agntc's value over a one-shot `cp` is *lifecycle* — `update` (nuke-and-reinstall) and `remove`. Type detection created a new hazard: `update` re-clones and re-runs detection, so an install could re-resolve to a *different* type or skill-set than was originally installed. The lifecycle rules below prevent that.

### Current behaviour (baseline)

- `ManifestEntry` today carries `ref, commit, installedAt, agents, files, cloneUrl, constraint` — **no `type` field**.
- The manifest is a flat `Record<string, ManifestEntry>`, keyed `owner/repo` (standalone) or `owner/repo/<unit>` (collection member).
- **A collection is a transport, not a stored unit** — the collection pipeline records *each selected child as its own entry*. No collection-level entry exists.
- **Nested collections are explicitly unsupported** (skipped with a warning), bounding recursion.

### Decision: record the resolved type, replay it, never silently morph

- **Add a `type` field to `ManifestEntry`**, values `"skill" | "plugin"` only. A collection is never stored — its selected children persist as their own skill/plugin entries keyed `owner/repo/<unit>`. However the type was derived (structure, config `type`, or `--plugin`), the *resolved* value is what's persisted. The three derivation paths collapse to one recorded fact.
- **`update` replays the recorded type**, not blind re-detection. Reinstalling the recorded unit re-copies whatever is in the tree now, so benign additions (e.g. the author adds an `agents/` dir to an existing plugin) are picked up *without* changing the recorded type — we're replaying "plugin," not re-deriving it.
- **Derive-before-delete.** On `update`, validate the unit can still be reinstalled as its recorded type *before* removing any existing files. Never delete first and discover failure.
- **Irreconcilable change → abort + loud alert, existing install left intact.** If the tree no longer supports the recorded type (unit/path gone, structure incompatible — e.g. was a bare skill, now a collection), do **not** try to save it or auto-migrate. Abort that unit's update, keep what's installed, emit a clear error describing what changed. The remedy is manual (`remove` then `add` — the user's call).
- **Member entries replay by path, not by repo re-classification.** A collection member persists as `owner/repo/<unit>` with its own recorded type, and `update` re-copies *its own subdir*. A later root-level reshape of the source repo (e.g. skills-only → plugin once the author adds an `agents/` dir) does **not** reach into or retroactively bundle existing member entries — they stay independent units as originally chosen. Only a vanished member subdir trips the abort path.
- **Per-member abort granularity.** `update` operates per manifest entry. A plugin is one entry → atomic (abort = the whole plugin stays). Collection members are **independent entries by construction** — that independence is what makes it a collection and not a plugin — so one member aborting while siblings advance is correct, not a coherence hazard. agntc owes **no** collection-level coherence guarantee (lockstep is what `plugin` is for; there is deliberately no collection record). Each aborted entry is reported loudly.

### Legacy backfill (pre-`type` manifest entries)

Existing manifests predate the `type` field, so the first `update` after this feature has nothing to replay and must establish a type once, then fix it into the manifest.

- **Backfill `type` from the recorded `files`** (the local install is ground truth) — **not** from a fresh re-clone or re-detection.
- **Why not re-derive from the remote:** backfill runs at the first `update`, which re-clones the *current* remote — and an author may have dropped `agntc.json` by then (the exact configless migration this feature enables). A shape-unchanged but now config-absent skills-only repo would re-derive as `collection`, silently flipping a `plugin` install. Config-presence (not shape) was the load-bearing assumption, and config-presence is precisely what this feature encourages authors to change.
- **How `files` encode the type:** an entry that wrote to `agents/`/`hooks/` targets, or holds multiple skill dirs under one key → `plugin`; a single `.claude/skills/<name>/` → bare skill. Backfill reads `files`, records `type`, and is therefore immune to any drift in the remote's current config or shape. `update` preserves the identity of *what the user installed*, not a re-interpretation of a remote that may have changed underneath them.
- **Backfill is per manifest entry, and an entry is always a unit (skill/plugin) — never a collection.** A legacy collection-member entry (`owner/repo/<unit>`) backfills from its own `files` like any other unit. No collection type is ever derived or stored.
- This also covers the *Backward-Compat / Migration* update concern — no separate migration step.

### Keying

Identity is dir-basename (see *Identity & Naming*), so manifest keys are **unchanged from today**: `owner/repo` for a standalone bare skill or plugin, `owner/repo/<unit-dir>` for a collection member. No frontmatter-derived keys. Configless adds no new keying scheme — it reuses the existing one.

### Deferred

- **Collection grouping for bulk `remove`** (unit-vs-collection granularity) stays a minor open thread — not forced by the keying decision; revisit only if the remove UX calls for it.

---

## Agent Selection

The constraint model is already settled and stays unchanged. Configless forces only one small mechanical change.

### Constraint model (unchanged)

- **Declared agents are a hard ceiling.** Undeclared agents are excluded from the selection prompt entirely. A Codex user is never offered a Claude-only unit for Codex.
- **Auto-select** when a single declared agent is detected.
- **Per-plugin silent skip** in collections — undeclared agents are dropped per-plugin during copy, no warning.

### The one configless delta

Today agent selection returns `[]` ("install for nobody") when there is no declared-agents list. Correct under v1 (config mandatory → empty = misconfigured), wrong under configless where "no declaration" is a legitimate, common state meaning **"installable for anything."**

### Decision

**Constraint model unchanged. The only rework: source the candidate list from `KNOWN_AGENTS` when there is no valid author declaration.**

- **Valid, non-empty `agents` in config** → hard ceiling, exactly as today.
- **No valid constraint** → offer all `KNOWN_AGENTS` (claude / codex / cursor), pre-tick detected agents, user picks. This replaces the `return []` footgun.

### "No valid constraint" — unified across three cases

All three fall back to the same default (offer all `KNOWN_AGENTS`):

1. config **absent** (configless)
2. config present but `agents: []` (empty — "a skill for nothing" makes no sense)
3. config **malformed** (unparseable)

Rationale: an invalid/unusable `agents` declaration carries no usable author intent, so it is treated identically to no config at all. **No hard errors for config problems** — config reading treats parse failures as "no usable config" and falls back to the default.

### Trade-off accepted

A malformed config silently falls back to "all agents" rather than erroring, which could mask an author's typo (their Claude-only intent silently becomes all-agents). Judged acceptable for leniency/simplicity — the installer still chooses, and detection pre-ticks sensibly. (Note the deliberate asymmetry with type detection: for *agents*, missing/invalid info → lenient default; for *type*, contradictory info → loud error.)

---

## Working Notes
