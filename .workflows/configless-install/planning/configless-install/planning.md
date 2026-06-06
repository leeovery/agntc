# Plan: Configless Install

## Phases

### Phase 1: Configless detection foundation — structural type, lenient config, agent default
status: approved
approved_at: 2026-06-06

**Goal**: Make type/identity/installability derive from directory structure alone and demote config to its two narrow jobs (`agents`, `type?`). Establish the governing posture (missing info → lenient default; contradictory info → loud error) in the lowest-level modules that every install path consumes: `type-detection.ts`, `config.ts`, and `agent-select.ts`.

**Why this order**: This is the foundation the feature names as "the small part" structurally but the load-bearing primitive everything else builds on. Every subsequent phase (`add`, collections, lifecycle) calls into structural detection, lenient config reading, and the agent default. Building these contracts first means later phases add to a working detection core rather than depending on unbuilt behaviour. Per the feature Phase 1 strategy, it integrates with the existing `detectType`/`readConfig`/`selectAgents` shape rather than re-proving architecture.

**Dependencies**: None (builds on existing modules).

**Acceptance**:
- [ ] `detectType` resolves type from structure via a single structural path: root `SKILL.md` → bare skill; `skills/`-only → skills-only ambiguous (default collection); ≥1 asset-kind dir (any combination not skills-only) → plugin; non-asset child dirs structurally resolving to units → collection; nothing reachable → not-agntc. Config presence is no longer an input to detection.
- [ ] A bare `SKILL.md` repo with no `agntc.json` (the `refero_skill` shape) detects as bare skill and is installable (no longer rejected as not-agntc).
- [ ] The two-level override resolves only the skills-only case: config `type: "plugin"` bundles a skills-only repo; `--plugin` flag bundles it and beats config `type` on disagreement; precedence is `--plugin` > config `type` > structure.
- [ ] A recognised `type: "plugin"` that contradicts an unambiguous structure (bare skill, or member-dirs collection) is a hard error naming the source and conflict; `--plugin` on a bare skill or member-dirs collection errors identically. `type: "collection"` and all other/unknown values are silently ignored.
- [ ] `readConfig` is lenient: missing file, malformed JSON, and missing/empty `agents` all return "no usable config" without throwing; unknown keys are ignored; only `agents` and `type` are read.
- [ ] `selectAgents` sources candidates from `KNOWN_AGENTS` (pre-ticking detected agents, always prompting) when there is no valid declaration; a valid non-empty `agents` list remains a hard ceiling with single-detected-agent auto-select unchanged. The `return []` "install for nobody" path is gone.
- [ ] Existing detection/config/agent-selection behaviour for config-bearing repos (e.g. `agentic-workflows` Claude-only) is preserved; full suite green.

#### Tasks
status: draft

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-1-1 | Lenient config reading with optional type | missing file, malformed JSON, missing agents key, empty agents array, all-unknown agents, unknown extra keys, unrecognised type value, non-permission IO errors still propagate |
| configless-install-1-2 | Single structural detection path | bare SKILL.md no config (refero_skill shape), SKILL.md alongside asset dirs, skills-only defaults to collection, agents/hooks-only is plugin, one-level child scan, empty/unreadable dir, files-only root |
| configless-install-1-3 | Structural collection membership (one level down) | configless members, mixed config-bearing and configless members, child with neither SKILL.md nor asset dir skipped, nested-collection child not recursed, no qualifying children -> not-agntc |
| configless-install-1-4 | Two-level type override and conflict hard error | type:"plugin" bundles skills-only, --plugin bundles skills-only, --plugin beats config type, redundant no-op on multi-asset plugin, type:"plugin"/--plugin on bare skill -> error, type:"plugin"/--plugin on member-dirs collection -> error, type:"collection" ignored, unknown type ignored |
| configless-install-1-5 | KNOWN_AGENTS default in selectAgents | no declaration -> all KNOWN_AGENTS, empty declaration -> all KNOWN_AGENTS, default never auto-selects with one detected, detected pre-ticked, valid ceiling unchanged, single-declared-detected auto-selects, cancel/zero-selection returns [] |

### Phase 2: Configless standalone install through `add`
status: approved
approved_at: 2026-06-06

**Goal**: Wire the Phase 1 primitives through the `runAdd` standalone path so a configless bare skill or plugin installs end-to-end: detect structurally, select agents via the new default, copy, and persist. Add the `--plugin` installer override and the tree-path subpath as the unit selector, keeping identity = directory basename throughout.

**Why this order**: This is the headline user-facing capability — installing `referodesign/refero_skill` with zero config. It depends on Phase 1's detection/config/agent contracts and delivers the first complete configless install a user can run. It precedes collections and lifecycle because the single-unit `add` path is the simpler vertical slice and establishes the install wiring those phases extend.

**Dependencies**: Phase 1 (structural detection, lenient config, `KNOWN_AGENTS` agent default).

**Acceptance**:
- [ ] `agntc add referodesign/refero_skill` (bare `SKILL.md`, no config, untagged) installs the skill under its repo-basename folder/manifest key, with no `agntc.json` left on disk, agents chosen from the `KNOWN_AGENTS` default.
- [ ] The `add` path no longer treats null config as "must be a collection" — a configless bare skill or configless multi-asset plugin installs standalone; not-agntc still exits cleanly.
- [ ] `--plugin` is accepted by the `add` command and forwarded as the skills-only override; it bundles a skills-only repo and is a hard error (non-zero, named conflict) on a bare skill or member-dirs collection.
- [ ] A tree-path URL selector (`.../tree/<ref>/<subpath>`) installs the unit at `<subpath>` keyed `owner/repo/<subpath>`; `@`-suffixes remain version refs only and are rejected on tree URLs.
- [ ] Config-bearing standalone installs (declared-agents ceiling, auto-select) behave exactly as before; full suite green.

### Phase 3: Structural collection membership and selection
status: approved
approved_at: 2026-06-06

**Goal**: Redefine collection membership as "a child dir that structurally resolves to a unit" by recursing Phase 1 detection one level down, replacing the `has-agntc.json` enumeration. Drive selection with the existing prompt and tree-path selector; read child config only for agents when present; keep nested collections unsupported.

**Why this order**: Collections are the multi-unit extension of the Phase 2 install path and reuse its detection, agent-default, and copy wiring. It comes after standalone install because the collection pipeline is a per-member fan-out over the single-unit logic already proven in Phase 2, and because the configless change here (structural membership) only matters once members can be configless.

**Dependencies**: Phase 1 (one-level-down structural detection), Phase 2 (single-unit install wiring the pipeline fans out over).

**Acceptance**:
- [ ] Collection membership comes from structural detection per immediate child dir (child `SKILL.md` → bare-skill member; child with ≥1 asset-kind dir → plugin member; neither → skipped), not from `agntc.json` presence.
- [ ] A collection of configless members enumerates and installs selected members, each keyed `owner/repo/<unit>` under its basename; config-bearing and configless members coexist, each member's agents resolved per the Phase 1 rules.
- [ ] A stray root `agntc.json` on a member-dirs structure does not reclassify it (no-`type` ignored; `type: "plugin"` is a hard error); a collection container is never treated as carrying installable config.
- [ ] Select-all installs every member; the tree-path selector targets a single member directly without prompting; nested collection members are skipped with a warning (one level only).
- [ ] Existing collection behaviour for config-bearing collections still works; full suite green.

### Phase 4: Manifest type lifecycle — record, replay, derive-before-delete, legacy backfill
status: approved
approved_at: 2026-06-06

**Goal**: Add `type?: "skill" | "plugin"` to `ManifestEntry`, persist the resolved type on install, and make `update` replay the recorded type rather than blind re-detection — with derive-before-delete validation, irreconcilable-change abort that leaves the install intact, per-entry abort granularity, and in-memory legacy backfill from `files` on manifest read.

**Why this order**: Lifecycle correctness depends on installs already recording a resolved type, which Phases 2–3 produce. This phase closes the hazard the spec calls out: that configless `update` re-clones and could silently morph type. It comes after the install paths because there must be a "resolved type" to record and replay, and its abort/backfill rules are a distinct risk profile (data migration, non-destructive validation) warranting its own checkpoint. Backfill on read makes `type` available uniformly to `list`/`remove`/`update`.

**Dependencies**: Phase 1 (per-type detection predicates), Phases 2–3 (installs that record the resolved type).

**Acceptance**:
- [ ] `ManifestEntry.type` is optional (`"skill" | "plugin"`); the resolved type from any derivation path (structure, config `type`, `--plugin`) is persisted on install for standalone units and collection members alike (no collection-level entry).
- [ ] `update` replays the recorded type: recorded `skill` re-copies the unit dir if root `SKILL.md` still exists (benign added asset dirs ignored); recorded `plugin` re-copies present asset dirs if ≥1 asset-kind dir remains. The re-cloned tree is validated against the recorded-type predicate **before** any file removal.
- [ ] Irreconcilable change (vanished unit/subpath, structure no longer supports recorded type) aborts that unit's update with the existing install left fully intact, a clear message naming recorded-vs-current and the manual `remove`+`add` remedy, and an "aborted" report.
- [ ] Abort granularity is per manifest entry: a plugin aborts atomically; a collection member aborts independently of its siblings; each failure is reported loudly with its own reason.
- [ ] Legacy `type`-less entries backfill in-memory on manifest read from `files` (asset-target/multi-skill-under-one-key → plugin; single skills dir → skill), persisted on next write; reading legacy manifests never errors; backfill derives from local `files`, never a re-clone.
- [ ] Tagless `ref: null` → HEAD tracking and existing tagged-constraint behaviour are unchanged; commands reading the manifest (`list`, `remove`) tolerate and benefit from the backfilled `type`; full suite green.

### Phase 5: Copy-safety hardening — path-traversal and symlink-escape guards
status: approved
approved_at: 2026-06-06

**Goal**: Add the two pre-flight guards the configless input demands: a path-traversal guard validating any source-supplied subpath resolves within the clone, and a symlink-escape guard rejecting any symlink whose target resolves outside the cloned repository root. Both run as a pre-flight scan of the unit tree before any copy, on both `add` and `update`'s re-copy.

**Why this order**: This is hardening that protects the copy path configless newly exposes (the trust gate `agntc.json`-presence is removed in earlier phases). It comes last because it guards the copy operations established across Phases 2–4 and is orthogonal to install/lifecycle correctness — a distinct security-risk checkpoint. The bare-skill case (Phase 2) and the re-copy on update (Phase 4) must exist before their copy paths can be routed through the guards.

**Dependencies**: Phase 2 (bare-skill/standalone copy), Phase 3 (member copy), Phase 4 (`update` re-copy path).

**Acceptance**:
- [ ] A pre-flight scan runs before every copy that ingests cloned content (`add` and `update`'s re-copy); on any violation it errors before writing anything, exits non-zero, and names the offending unit/path — no on-disk window for escaping content.
- [ ] The path-traversal guard rejects a selector `<subpath>` that resolves outside the clone and is a no-op for whole-repo (no-selector) installs like the bare-skill case.
- [ ] The symlink-escape guard rejects any symlink whose target resolves outside the cloned repository root (absolute paths, `..`-escapes), runs on every install including bare skills, and allows symlinks resolving anywhere inside the clone.
- [ ] Broken (nonexistent-target) symlinks are evaluated lexically: lexical escape above the clone root → reject; otherwise copied verbatim.
- [ ] The single recursive `cp` runs only on a verified-clean tree; the copy mechanism itself (recursive copy, keep everything, post-copy `agntc.json` deletion) is otherwise unchanged; full suite green.
