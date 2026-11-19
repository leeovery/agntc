---
status: complete
created: 2026-06-06
cycle: 4
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Cycle-4 traceability analysis of the configless-install plan (planning.md +
phase-1..5-tasks.md, 25 tasks) against the validated specification, both directions, read
fresh. All three prior-cycle findings remain resolved and internally consistent:

- **c1** — a `type`-only config (no `agents`) is now retained as `{agents:[], type}` so the
  spec's reserved skills-only-bundle use of `type` survives to detection (task 1-1).
- **c2** — clean; the cycle-1 cascade pinning `configType: config?.type` at the single
  `detectType` call (tasks 2-1/2-2/3-5) verified consistent.
- **c3** — a top-level / subpath not-agntc source now exits **non-zero** with a source-named
  `p.cancel` (tasks 2-1/2-3, Phase 2 acceptance), matching *Error & Abort Behaviour → Hard
  errors*; the collection-member not-agntc *re-detect skip* (task 3-4) correctly remains a
  loud per-member skip with siblings continuing.

No remaining or newly-introduced traceability gaps were found. Convergence reached.

### Direction 1: Specification → Plan (completeness)

Every spec section has plan coverage with adequate depth:

- **Overview / anchor cases** — `refero_skill` (bare `SKILL.md`, no config, untagged) covered
  through 1-2, 2-1, 4-1, 5-2/5-3; `agentic-workflows` (Claude-only multi-asset plugin,
  `configType: undefined` → structural plugin) preserved across 1-2, 2-1, 1-5. Governing
  posture (missing→lenient default; contradictory→loud error) realised in 1-1/1-4/1-5.
- **Config Model** — lenient reading (1-1), `{agents, type?}` shape, presence-never-signals-type
  (1-2, 2-1), unknown-key tolerance (1-1), recognised-`type`/leniency boundary (1-1 raw
  pass-through + 1-4 recognition gate), `type:"collection"`/unknown ignored (1-4),
  collection-container-never-carries-config (3-5), no install flags except `--plugin` (2-2).
- **Structural Type Detection** — four shapes, single structural path, canonical plugin rule
  (≥1 asset dir, skills-only exception), two-level override precedence
  (`--plugin` > config `type` > structure), skills-only resolution, type-vs-structure hard
  error, selector grammar (tree-path URL, `@` is ref-only), selector/`--plugin` orthogonality
  (1-2, 1-3, 1-4, 2-2, 2-3, 3-5, 3-6).
- **Identity & Naming** — dir-basename throughout, no frontmatter parsing, recursive
  keep-everything copy, agntc.json deleted post-copy (2-1, 2-3, 4-1/4-2 keying, copy mechanism
  unchanged in 5-3).
- **Manifest Keying & Lifecycle** — `type?` field + optionality (4-1), persist resolved type
  standalone (4-1) and per member (4-2, no collection entry), replay (skill 4-4, plugin 4-5),
  derive-before-delete predicates with validate-before-nuke ordering, member-by-path replay,
  irreconcilable abort intact + non-zero (4-6), per-entry abort granularity + partial-success
  exit (4-7), in-memory legacy backfill from `files` on read with anti-drift rationale and
  single-skill-ambiguity collateral (4-3), unchanged keying.
- **Agent Selection** — KNOWN_AGENTS default replacing `return []`, hard ceiling, auto-select
  scoped to declared-single only (never in the configless default), three unified no-constraint
  cases (1-5; per-member 3-2; update preserves installed agents via `computeAgentChanges`).
- **Collection Membership & Selection Flow** — structural one-level membership (1-3, 3-1),
  per-child agents (3-2), select-all/selector UX (3-6), nested unsupported with pipeline
  warning (3-4), stray-root config (3-5), dead-`ConfigError` removal (3-3).
- **Version Pinning** — reuse tagless→HEAD unchanged, no new code (carried as "unchanged" in
  P4 acceptance and 4-3/4-4 context). The "resolve branch name at display time, do not store"
  note is a rejected/deferred design decision, correctly producing no task.
- **Copy-Safety Hardening** — path-traversal guard (5-1), symlink-escape guard with clone-root
  boundary + lexical broken-link handling (5-2), pre-flight wiring on add (5-3) and update
  re-copy with clone-root threading (5-4); copy mechanism + post-copy `agntc.json` deletion
  unchanged; tree-size/hook caps correctly deferred (out of scope).
- **Backward-Compat / Migration** — existing installs via legacy backfill (4-3), `init`
  unchanged (no task — correctly omitted), config schema (1-1/1-2), stray root config (3-5),
  collection child-config dependency (3-1).
- **Error & Abort Behaviour** — detection-time hard errors pre-flight non-zero incl. not-agntc
  (1-4, 2-2, 2-1/2-3, 3-5, 5-3), update abort intact (4-6), partial collection outcomes +
  non-zero command exit (4-7), copy-failed distinct from abort (4-6).

### Direction 2: Plan → Specification (fidelity)

All plan content traces back to the spec; no hallucinated content found. Higher-risk items
re-spot-checked this cycle:

- The `--plugin > config type` precedence "moot in the skills-only case" framing (1-4) is
  spec-grounded (both inputs push to "plugin"); centralising resolution is faithful.
- EACCES / non-ENOENT IO propagation and cancel/zero-selection `[]` (1-1, 1-5) are faithful
  preservation of behaviour the spec leaves untouched ("config reading is lenient" does not
  extend to swallowing real filesystem failures).
- Retained-`type`-only-config (1-1) is grounded in *Config Model → Config shape* and
  *Structural Type Detection → Skills-only resolution* — not an invented capability.
- The not-agntc loud non-zero exit (2-1/2-3) now traces to *Error & Abort Behaviour → Hard
  errors* (the c3 fix) rather than to legacy v1 exit-0 behaviour.
- Legacy backfill's empty-`files` → `skill` default, single-skill-ambiguity, and "derive from
  local files only (no re-clone)" (4-3) all trace to *Legacy backfill* verbatim.
- Phase 5 update pre-flight running the symlink scan only (no path-traversal on update) is
  spec-faithful: update replays a recorded key, not a fresh source-supplied selector.
- Per-task scope boundaries, verification-only 3-5/3-6, and the validate-before-nuke seam
  shared across 4-4/4-5/5-4 are consistent with the spec and with each other.

## Findings

None. The plan is a faithful, complete bidirectional translation of the specification. All
prior-cycle findings (c1, c3) are resolved and their cascades internally consistent; c2 and
c4 are clean.
