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

### Recognised `type` values and the leniency-vs-error boundary

Two leniency rules coexist and must be reconciled explicitly:

- **Config *reading* is lenient.** A missing `agntc.json`, a syntactically malformed one, or one missing/empty `agents` is treated as "no usable config" — no error (see *Agent Selection*). (This changes today's `readConfig`, which throws on parse failure / missing `agents`.)
- **A *well-formed, recognised* `type` that contradicts an unambiguous structure is a hard error** (see *Structural Type Detection*). The error path fires only after the config parses successfully and yields a recognised `type`.

So the boundary is: **unparseable / unusable config → lenient (ignored); well-formed config with a recognised `type` that can't be realized → loud error.**

- **The only recognised `type` value is `"plugin"`.** It is the skills-only bundle disambiguator.
- **Any other `type` value — including `"collection"` — is unrecognised and ignored** (lenient, like any unknown key). `"collection"` is *not* a supported declaration; structure already expresses collection, so an author never needs it. (This supersedes the discussion's incidental "`type: collection` on a multi-asset plugin → error" example — that value simply isn't honoured; the realizability error applies to `type: "plugin"` on a non-bundleable structure.)

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

### Canonical plugin rule (reconciles the table and prose)

A **plugin** is structurally: *a root containing one or more asset-kind dirs (`skills/`, `agents/`, `hooks/`), with the single skills-only exception.* The four-shapes table's `skills/` **+** (`agents/` or `hooks/`) is the common illustrative case, **not** the exhaustive rule. Concretely:

- `skills/` + `agents/` and/or `hooks/` → **plugin**
- `agents/`-only, `hooks/`-only, or `agents/` + `hooks/` (no `skills/`) → **plugin** (≥1 asset dir, not skills-only)
- `skills/`-only (no other asset dir) → **the skills-only ambiguous case** (default collection; see resolution above)

This is consistent with the existing `detectType` behaviour (`foundAssetDirs.length > 0 → plugin`). The same rule applies one level down for collection membership (a child with ≥1 asset-kind dir is a plugin member).

### `--plugin` scope (which thing it acts on)

`--plugin` acts on the **resolved unit being installed**, and resolves *only* a skills-only ambiguity:

- Source resolves to a **skills-only** unit (whole repo, or a selected member) → `--plugin` bundles it as a plugin. This is its valid use.
- Source resolves to an **unambiguous member-dirs collection** (no selector, installed via the prompt) → `--plugin` is a **hard error** (an attempt to bundle a non-bundleable collection, per the type-vs-structure conflict rule). To install every member, use **select-all in the prompt**, not `--plugin`.
- Source resolves to an unambiguous **multi-asset plugin** → `--plugin` agrees (redundant, no-op) — it already is a plugin.
- Source resolves to an unambiguous **bare skill** → `--plugin` is a **hard error** (it would force `skill`→`plugin`, exactly as `type: plugin` on a bare skill errors).

### Skills-only resolution (the ambiguous case)

- **Default → collection (menu)** — Vercel-compatible, the common third-party path. Works flag-free.
- **Author override** → config `type: plugin` bundles it (even a single skill).
- **Installer override** → `--plugin` flag bundles it.
- On disagreement between the two overrides in this case, **`--plugin` beats config `type`** (precedence above).

### Type-vs-structure conflict → hard error

`type`/`--plugin` resolve **only** the skills-only case. A declared type (or flag) that contradicts an *unambiguous* structure is **unrealizable → hard error**, not a forced interpretation:

- `type: plugin` on a member-dirs collection → error.
- `type: plugin` on a bare skill → error.
- `--plugin` on a member-dirs collection (or any non-bundleable structure) → error, exactly as `type: plugin` would. The flag's *only* extra power is winning the tie in the ambiguous case — it cannot realize an impossible structure.

(The realizability error applies only to the recognised value `type: "plugin"`. `type: "collection"` and any other value are unrecognised and silently ignored — see *Config Model → Recognised `type` values* — so they never reach this error path.)

This is the deliberate asymmetry of the governing posture: **missing info → default (lenient); contradictory info → error (loud).**

### Selector / `--plugin` orthogonality

A source selector (the tree-path URL — see *Source selector grammar*) and `--plugin` are orthogonal axes:

- **Selector = *which* unit** to install.
- **`--plugin` = *how to resolve the selected unit's* skills-only ambiguity.**

So a selector + `--plugin` reads as "install the selected unit, resolve *its* ambiguity as plugin." If the selected unit isn't skills-only/bundleable, the type-vs-structure conflict rule applies (agrees → redundant/no-op; contradicts → error). There is no bespoke selector+flag combination rule.

### Source selector grammar (canonical)

The discussion referred informally to `owner/repo@unit` for member selection, but the existing source parser already assigns `@` a different meaning. To stay implementable and internally consistent, the canonical grammar is:

- **`@<ref>` / `#`-style suffix = version ref or constraint only.** A bare-shorthand or URL suffix `@v1.2.0`, `@main`, `@^1.2`, `@~1.2` selects a tag/branch (or semver constraint). `@` is **never** a unit selector. (This is the existing `parseSource` behaviour — `classifyRefOrConstraint`.)
- **Unit / member selection = the GitHub tree-path URL** `https://<host>/<owner>/<repo>/tree/<ref>/<subpath>`. This is the existing `DirectPathSource`: it yields `ref = <ref>`, `targetPlugin = <subpath>`, and manifest key `owner/repo/<subpath>`. The `<subpath>` is the in-repo path of the unit to install (a collection member, or any nested unit). Tree URLs **cannot** also carry an `@ref` suffix (the parser rejects it; the ref lives in the URL path).
- **No `owner/repo@unit` shorthand is introduced** — it would be indistinguishable from `owner/repo@ref`. Direct member targeting without prompting uses the tree-path URL.
- Whole-repo install (no selector) uses bare shorthand / plain HTTPS / SSH URL / local path, exactly as today.

The **path-traversal guard** (see *Copy-Safety*) validates that a selector's `<subpath>` resolves *within* the clone before any copy.

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
- **Single-skill ambiguity is accepted collateral.** A legacy entry whose `files` are a single `.claude/skills/<name>/` (or the equivalent per-agent skills dir) with no `agents/`/`hooks/` targets backfills as `skill`, even if it was originally bundled as a single-skill plugin — the two are indistinguishable from `files` alone. This is safe: replay behaviour is identical (both re-copy the one skill dir). The only divergence is if the author later adds an `agents/`/`hooks/` dir — replaying `skill` would not pick it up; the user's remedy is the standard manual `remove` + `add`. No tiebreaker is introduced; legacy backfill favours the common case (bare skill) over the rare one.
- This also covers the *Backward-Compat / Migration* update concern — no separate migration step.

### `type` field: optionality and backfill timing

- **`type` is optional on the `ManifestEntry` interface** (`type?: "skill" | "plugin"`). It must be optional so legacy manifests (which predate the field) still parse; every reader must tolerate its absence.
- **Backfill happens in-memory on manifest *read*** — mirroring the existing inline `cloneUrl` backfill in `readManifest`. When a legacy entry lacking `type` is read, its type is derived from `files` (per the rules above) and populated on the in-memory entry, then **persisted on the next manifest write**. This makes `type` available uniformly to *all* commands that read the manifest (`list`, `remove`, `update`), not only `update`, and removes any "only at first update" ambiguity.
- Reading legacy manifests never errors on the missing field; backfill is total (every `files` shape maps to exactly one of `skill`/`plugin`).

### Derive-before-delete validation predicate (per recorded type)

`update` replays the recorded type and validates the re-cloned tree *supports* it **before** nuking files. The concrete pass/fail predicate, by recorded type:

- **Recorded `skill`** → the unit's root `SKILL.md` must still exist. If present, replay as a bare skill (re-copy the unit dir) regardless of any newly-added asset dirs — the *recorded* type is authoritative, not a re-derivation. If `SKILL.md` is gone → **abort**.
- **Recorded `plugin`** → at least one asset-kind dir (`skills/`/`agents/`/`hooks/`) must still exist at the unit root. If so, re-copy whatever asset dirs are present now (benign additions picked up). If no asset dir remains (e.g. now a bare skill or member-dirs collection) → **abort**.
- **Member entries** apply the *same* per-type predicate to their own subdir (`owner/repo/<unit>`). A vanished subdir is the common abort trigger, but a subdir that still exists yet no longer supports its recorded type aborts identically. (This refines the looser "only a vanished member subdir aborts" wording to stay consistent with the root-level rule.)

Validation runs entirely against the re-cloned tree before any file removal; on failure the existing install is left intact (see *Error & Abort Behaviour*).

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

### Agent detection signal and auto-select interaction

- **"Detected agents"** are determined by the existing `detectAgents` path — each registered driver's `.detect(projectDir)` (e.g. presence of the agent's project dir/marker). Configless reuses this unchanged; it is the signal used to pre-tick options.
- **Pre-tick, always prompt** in the no-constraint default: candidates = all `KNOWN_AGENTS`, detected ones pre-ticked, the user always picks. There is **no auto-select** in this path — a multi-candidate list always warrants a choice.
- **Auto-select stays scoped to the declared-single-agent case only**: when config declares exactly one agent and it is detected, install proceeds without a prompt (today's behaviour, unchanged). The configless default never auto-selects even if exactly one agent is detected, because the ceiling (all `KNOWN_AGENTS`) is not a single-agent declaration.

### Trade-off accepted

A malformed config silently falls back to "all agents" rather than erroring, which could mask an author's typo (their Claude-only intent silently becomes all-agents). Judged acceptable for leniency/simplicity — the installer still chooses, and detection pre-ticks sensibly. (Note the deliberate asymmetry with type detection: for *agents*, missing/invalid info → lenient default; for *type*, contradictory info → loud error.)

---

## Collection Membership & Selection Flow

The current collection pipeline enumerates installable members by scanning immediate child dirs for `agntc.json` and reads each child's config for its agents. With configless members carrying no config, that enumeration finds nothing. This section redefines membership structurally.

### Decision

**Collection membership = "a child dir that structurally resolves to a unit." Recurse the same structural detection one level down; drive selection with the existing prompt + source-string selector. No flags.**

### Membership (structural, one level down)

For each immediate child dir, run the *same* structural detection used at the root:

- child has `SKILL.md` → **bare-skill member**
- child has asset-kind dirs (`skills/` / `agents/` / `hooks/`) → **plugin member**
- child has neither → **not a member, skip it**

The pickable list comes from this structural scan, **replacing** the "has `agntc.json`" enumeration.

### Agents (collection-wide, one prompt)

Agents are chosen **once for the whole collection**, not per member — prompting per member is confusing and unnecessary (the author's `agents` ceiling is a constraint to apply, not a choice to re-ask). The flow:

- **Candidates = the union of the installable members' ceilings.** A configless member contributes all `KNOWN_AGENTS`; a member declaring `agents` contributes that set. So the prompt offers every agent that *at least one* member supports. Detected agents are pre-ticked.
- **The installer picks once.** Each member then installs for **(the pick ∩ that member's own ceiling)** — the author's hard ceiling is honoured per unit, silently (a configless member just takes the whole pick).
- **A member with zero overlap** (the pick excludes everything its author allows) is **skipped and noted** in the summary (e.g. `alpha: skipped — author restricts to claude, none selected`) — non-fatal, siblings proceed.
- **Auto-select** when the union is a single detected agent (no prompt), matching the standalone single-agent rule.
- **Empty selection / cancel** aborts the whole collection cleanly (there is nothing to install for).
- Config-bearing and configless members coexist in one collection; the union + per-member intersection is what reconciles their differing ceilings behind a single prompt.

### Selection UX (unchanged, flag-free)

- The existing interactive prompt for "which member(s)?" (one / some / all).
- A source-string selector — the GitHub tree-path URL `https://<host>/<owner>/<repo>/tree/<ref>/<subpath>` (see *Source selector grammar*) — to pick a member directly without prompting. (`@` remains a version ref, not a member selector.)
- **"Install every member" is select-all in the prompt**, not `--plugin` (which only resolves a unit's skills-only ambiguity).

### Nested collections

Remain **unsupported** — a collection member that is itself a collection is not recursed into. Membership detection goes exactly **one level** down.

---

## Version Pinning for Untagged Repos

A configless repo like `refero_skill` has zero tags. The tagless case is **already handled** — configless doesn't introduce it and adds no new code here.

### Current behaviour (baseline, reused unchanged)

- Bare `owner/repo` install: latest-version resolution returns `null` when there are no tags, so the `ref = latest.tag` assignment is skipped. The entry lands as `ref: null`, `commit: <SHA>`, **no constraint**.
- The update check sees `ref === null` → routes to **`checkHead`**, a SHA-diff against the remote default-branch HEAD. So a tagless repo already tracks HEAD and stays updatable.
- Tagged repos: `^major.minor.patch` auto-constraint (npm/Composer-style) — minor/patch auto-apply; `0.x` and out-of-range majors shown but require an explicit bump. Unchanged.

### Decision

**Reuse the existing tagless→HEAD tracking unchanged; `ref: null` is the canonical tagless representation.**

- Untagged install (including every configless tagless repo) → `ref: null`, `commit: <SHA>`, no constraint → `update` routes to `checkHead`, SHA-diffing the remote's default-branch HEAD. Mechanism already exists; configless flows through the identical path — **no new code**.
- **No branch-name stored.** Recording the default-branch *name* as `ref` (→ `checkBranch`) was considered for `list` visibility but rejected:
  - it bifurcates the manifest — new tagless entries `ref: <branch>` vs legacy `ref: null` — two shapes for one concept;
  - `checkBranch` pins a *named* branch that breaks on a default-branch rename (`master`→`main`), whereas `checkHead` follows the symbolic default HEAD and is more robust.
- **`ref: null` is not vestigial:** `ref` records *user intent* (tag / branch / none), and `null` = "no explicit ref → follow default HEAD," comparing by the stored `commit`.
- If `list` wants to show the branch name, **resolve it at display time** — do not store it.
- Explicit `#ref` / `@tag` still pin exactly as today.

### Trade-off accepted

Branch-tracking has no semver gate, so "latest" could ship a breaking change — but the author published no versions to gate on, and the SHA move is visible in `list`/`update` before it's applied.

---

## Copy-Safety Hardening

A pre-existing exposure that configless **widens, not creates**. Cloning does `git clone --depth 1` with no size cap and no symlink handling; the bare-skill copy does a recursive `cp` of the whole clone, then deletes `agntc.json`. agntc already copies untrusted repo contents today — the *only* current trust gate is "the repo shipped an `agntc.json`," and configless removes exactly that gate, so the input becomes genuinely arbitrary third-party repos.

This is about not letting a repo read/write *outside* the directory it's meant to land in — distinct from skill *validation*, which is out of scope. The copy mechanism itself is unchanged (recursive `cp`, keep everything — see *Identity & Naming*).

### In scope for configless-install

1. **Path-traversal guard** — validate any source-supplied subpath (the tree-path URL's `<subpath>` — see *Source selector grammar*) resolves *within* the clone before copying. Mirrors Vercel's `isSubpathSafe`. Cheapest, highest value.
2. **Symlink-escape guard** — repo symlinks otherwise land verbatim (`cp` with `dereference: false`); reject any symlink that doesn't resolve inside the clone (the cloned repository root — see *Symlink guard: boundary* below for the precise predicate).

### Guard scope (complementary)

- **Path-traversal** protects **source resolution** (selectors/subpaths — where we copy *from*). It is a no-op for a no-selector whole-repo copy like the `refero_skill` bare-skill case.
- **Symlink-escape** protects **copied content** (what lands on disk) and runs on *every* install, bare skills included.
- So the headline bare-skill case is covered by the symlink guard; path-traversal simply has nothing to check there.

### Guard timing (pre-flight, before any copy)

Both guards run as a **pre-flight scan of the unit tree *before* any copy**:

- Walk the tree, validate selectors resolve within the clone and no symlink escapes the unit dir.
- On violation, **error before writing anything**.
- The single recursive `cp` then runs only on a verified-clean tree.

Pre-flight (not post-copy scan-and-remove) leaves no on-disk window where escaping symlinks exist, and matches the derive-before-delete principle: validate before you mutate.

### Symlink guard: boundary, broken links, and update coverage

- **Boundary = the cloned repository root.** A symlink is rejected only if its target resolves *outside the clone* (e.g. absolute paths like `/etc/...` or `..`-escapes above the clone root). Symlinks resolving anywhere *inside* the clone are allowed — this avoids rejecting a skill that legitimately points at a shared script elsewhere in the repo. ("Inside the unit's own directory" from the discussion is widened to "inside the clone" because the true security boundary is the untrusted clone, and a multi-dir plugin spans more than one dir.)
- **Broken symlinks** (target nonexistent) are evaluated **lexically**: if the link's target path lexically escapes the clone root → reject; otherwise it is copied verbatim (it is not an escape).
- **The guard runs on every copy that ingests cloned content — both `add` and `update`'s re-copy.** Since `update` re-clones the current (arbitrary) remote, its copy path is routed through the identical pre-flight guard before nuking/replacing files.

### Installed units never carry `agntc.json`

The current bare-skill copy deletes `agntc.json` from the destination after copying. This is **retained and generalised**: `agntc.json` is an author/install-time input, never a runtime artifact, so no installed unit (bare skill, plugin skill dirs, or collection member) ships `agntc.json` on disk. For plugins/members where only asset dirs are copied, a root `agntc.json` is naturally never copied; where a whole unit dir is copied (bare skill), the post-copy deletion removes it. Replay on `update` re-reads config from the freshly-cloned source, not from the installed tree, so removing it on disk has no lifecycle impact.

### Deferred (out of scope → validation idea)

Logged to `.inbox/ideas/2026-06-05--validation.md`, which also collects other validation concerns surfaced here (skill-validity gate, untrusted-frontmatter parsing safety, config-schema validation depth, agent-level identity collisions):

3. Tree size / file-count / depth caps.
4. Executable / hook safety (a configless plugin's `hooks/` = code that runs on the agent's next invocation).

Rationale: #1 and #2 are the true security boundary (escape prevention) and are cheap; configless is precisely what makes the input untrusted, so they belong here. #3 and #4 are broader hardening that applies to agntc's copy path regardless of configless — better discussed on their own.

---

## Backward-Compat / Migration & Config Schema

The model changes (structure-authoritative type, config demoted, configless installs) ripple across existing installs, the `init` scaffolder, the config schema, and the collection pipeline. Most resolved elsewhere; this collects the remainder.

### Existing installs

Covered by *legacy backfill* (see *Manifest Keying & Lifecycle*): the first `update` of a pre-`type` entry derives type once **from the recorded `files`** (local install = ground truth) and records it. Immune to the remote dropping config or reshaping between install and first update. **No separate migration step or tooling.**

### `init` scaffolder

**Stays agents-only and is unchanged by this feature.** Every path it offers (skill / plugin / collection) scaffolds a *structurally unambiguous* layout, so it never needs to emit `type`. `type` remains a hand-authored field for the rare skills-only bundle.

### Config schema

- Shape is `{ agents, type? }`.
- **Unknown keys are ignored** (lenient), so older/newer agntc versions don't choke on each other's configs.
- **Config *presence* is no longer a type signal** — only an explicit `type` property is read. (The v1 boundary-marker behaviour stays removed.)

### Collection with a stray root `agntc.json`

Structure decides it's a collection regardless of the stray config:

- Root config with **no `type`** → ignored.
- Root config declaring **`type: plugin`** on a member-dirs structure → **hard error** (unrealizable, per the type-vs-structure conflict rule).
- Presence alone never reclassifies it.

### Collection pipeline's child-`agntc.json` dependency

Resolved by *Collection Membership & Selection Flow*: membership comes from structural detection per child; child config is read only for agents when present.

---

## Error & Abort Behaviour

The governing posture's "loud" paths are the spec's primary behavioural contract, so their observable shape is defined here (acceptance criteria for hard errors, aborts, and partial collection outcomes).

### Hard errors (detection-time, before any write)

Type-vs-structure conflicts, `--plugin` on a non-bundleable structure, a not-agntc source, and a path-traversal/symlink-escape violation are **pre-flight failures**: nothing is written, the command exits **non-zero**, and the message names the offending source/unit and what conflicted (e.g. "`owner/repo` declares `type: plugin` but its structure is a collection of N members — cannot bundle"). These fire before any clone content is copied.

### `update` abort (irreconcilable change)

When derive-before-delete fails for a unit, that unit's existing install is **left intact** (no files removed), a clear message describes what changed (recorded type vs current structure) and states the manual remedy (`remove` then `add`), and the entry's `update` is reported as **aborted**.

### Partial outcomes for collections

`update` and multi-member installs operate **per manifest entry**:

- A single unit (bare skill / plugin) is one entry → atomic: it wholly succeeds, wholly aborts, or hard-errors.
- Collection members are independent entries → each is processed on its own; a member that aborts or errors does **not** stop its siblings. Each failed member is reported loudly with its own reason.
- **Command exit status**: the command exits **non-zero if any unit hard-errored or aborted**, even when other units succeeded (partial success). The summary reports per-unit outcomes (succeeded / aborted / errored) so the user sees exactly what changed and what didn't.

### Copy failure after nuke (residual, acknowledged)

Derive-before-delete eliminates the *type-incompatibility* stranding case, but a copy that fails *after* files are nuked (I/O error mid-reinstall) remains possible. As today, this is reported with a recovery hint ("the unit is currently uninstalled; run `agntc update <key>` to retry"). Not expanded by this feature.

---

## Out of Scope / Deferred

- **Validation** (skill-validity gate, untrusted-frontmatter parsing safety, tree/file/hook limits, config-schema depth, agent-level frontmatter-`name` collisions) — deferred to `.inbox/ideas/2026-06-05--validation.md` for a separate discussion.
- **Collection grouping for bulk `remove`** — minor; revisit only if the remove UX calls for it.
- **Ecosystem directions** — `.well-known` skill indices, hosted registry (`skills.sh`), and new verbs (`use`/`find`/`check`) — candidates to log separately, not part of this feature.

---

## Working Notes
