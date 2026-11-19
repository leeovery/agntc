---
status: complete
created: 2026-06-07
cycle: 6
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Cycle-6 traceability analysis of the configless-install plan (planning.md + phase-1..5-tasks.md,
25 tasks) against the validated specification, both directions, read fresh. Cycle 4 was clean;
cycle 5 found and fixed one gap — the collection-`add` partial-failure non-zero exit for a
member that hard-errors (`status: "failed"`), wired into task 5-3. This cycle verified that fix
is fully integrated and re-swept every spec section for any residual or newly-surfaced gap.

**Result: clean.** The cycle-5 fix is present and internally consistent in task 5-3, and no new
material spec-coverage or fidelity gap was found in either direction.

### Cycle-5 fix verification (task configless-install-5-3)

The collection-`add` partial-success exit-status contract is fully landed in phase-5-tasks.md:

- **Do step** — the split "Collection member violation handling" + "Non-zero exit on
  collection-`add` partial failure" steps are both present (phase-5-tasks.md ~157–158), with the
  `if (results.some((r) => r.status === "failed")) { throw new ExitSignal(1); }` placed after the
  manifest write and `renderCollectionAddSummary`, `skipped` members explicitly non-fatal, and the
  incorrect forward-reference to task 4-7 removed (replaced by "task 4-7 remains scoped to
  `runAllUpdates` and does **not** cover the `add` pipeline").
- **Acceptance criterion** — the matching criterion is present (phase-5-tasks.md ~168): commit
  siblings, render summary, then `ExitSignal(1)`; `skipped` member non-fatal.
- **Test** — `"a collection add with a failed member exits non-zero after committing siblings"`
  is present (phase-5-tasks.md ~178), asserting member-b committed (member-a not), summary
  rendered, `ExitSignal(1)` thrown after, and a `skipped`-only run does not throw.

This matches spec *Error & Abort Behaviour → Partial outcomes for collections* (lines 460–466):
"`update` **and multi-member installs** operate **per manifest entry** … exits **non-zero if any
unit hard-errored or aborted**." For collection-`add` there is no `update`-style abort path
(no recorded-type replay on install), so `status: "failed"` is the only exit-triggering outcome,
and `skipped` (not-agntc / nested-collection re-detect, task 3-4) is correctly benign.

### Direction 1: Specification → Plan (completeness)

Every spec section has plan coverage with adequate depth; no regressions vs cycles 1–5:

- **Overview / anchor cases** — `refero_skill` (bare `SKILL.md`, no config, untagged) covered
  via 1-2, 2-1, 4-1, 5-2/5-3; `agentic-workflows` (Claude-only multi-asset plugin) preserved via
  1-2, 2-1, 1-5. Governing posture (missing→lenient; contradictory→loud) realised in 1-1/1-4/1-5.
- **Config Model** — lenient reading (1-1), `{agents, type?}` shape, presence-never-signals-type
  (1-2, 2-1), unknown-key tolerance (1-1), recognised-`type`/leniency boundary (1-1 raw
  pass-through + 1-4 recognition gate), `type:"collection"`/unknown ignored (1-4),
  container-never-carries-config (3-5), no install flags except `--plugin` (2-2).
- **Structural Type Detection** — four shapes, single structural path, canonical plugin rule,
  two-level override precedence (`--plugin` > config `type` > structure), skills-only resolution,
  type-vs-structure hard error, selector grammar (tree-path URL; `@` is ref-only),
  selector/`--plugin` orthogonality (1-2, 1-3, 1-4, 2-2, 2-3, 3-5, 3-6).
- **Identity & Naming** — dir-basename throughout, no frontmatter parsing, recursive
  keep-everything copy, `agntc.json` deleted post-copy (2-1, 2-3, 4-1/4-2 keying; copy mechanism
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
  per-child agents (3-2), select-all/selector UX (3-6), nested unsupported with pipeline warning
  (3-4), stray-root config (3-5), dead-`ConfigError` removal (3-3).
- **Version Pinning** — tagless→HEAD reused unchanged, no new code (carried as "unchanged" in P4
  acceptance and 4-3/4-4 context); "resolve branch name at display time, do not store" is a
  rejected/deferred design note, correctly producing no task.
- **Copy-Safety Hardening** — path-traversal guard (5-1), symlink-escape guard with clone-root
  boundary + lexical broken-link handling (5-2), pre-flight wiring on add (5-3) and update
  re-copy with clone-root threading (5-4); copy mechanism + post-copy `agntc.json` deletion
  unchanged; tree-size/hook caps correctly deferred (out of scope).
- **Backward-Compat / Migration** — existing installs via legacy backfill (4-3), `init` unchanged
  (no task — correctly omitted), config schema (1-1/1-2), stray root config (3-5), collection
  child-config dependency (3-1).
- **Error & Abort Behaviour** — detection-time hard errors pre-flight non-zero incl. not-agntc
  (1-4, 2-2, 2-1/2-3, 3-5, 5-3), update abort intact (4-6), partial collection outcomes +
  non-zero command exit for both `update` (4-7) and multi-member `add` (5-3, the cycle-5 fix),
  copy-failed distinct from abort (4-6), copy-failure-after-nuke residual correctly carried as
  "not expanded" (acknowledged in 4-6 context; no task required).

### Direction 2: Plan → Specification (fidelity)

All plan content traces back to the spec; no hallucinated content found. Higher-risk items
re-spot-checked this cycle and remain spec-faithful:

- The cycle-5 collection-`add` non-zero exit (5-3) traces to *Error & Abort Behaviour → Partial
  outcomes for collections* ("multi-member installs", "non-zero if any unit hard-errored"); the
  `failed`-only trigger with `skipped` benign is the correct read of the "succeeded / aborted /
  errored" partition for a path that has no install-time abort.
- The `--plugin > config type` precedence "moot in the skills-only case" framing (1-4),
  EACCES/non-ENOENT IO propagation (1-1), retained-`type`-only config (1-1), not-agntc loud
  non-zero exit (2-1/2-3), legacy-backfill defaults (4-3), update-only symlink pre-flight (5-4),
  and verification-only 3-5/3-6 were re-checked and remain grounded.
- Per-task scope boundaries and the validate-before-nuke seam shared across 4-4/4-5/5-4 are
  consistent with the spec and with each other.

## Findings

None. The plan is a faithful, complete bidirectional translation of the specification. The
cycle-5 collection-`add` partial-failure exit fix is fully integrated into task 5-3 (Do step,
acceptance criterion, test) and internally consistent; all prior-cycle findings (c1, c3, c5)
remain resolved; c2, c4, and c6 are clean. Convergence holds.
