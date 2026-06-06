---
status: complete
created: 2026-06-06
cycle: 2
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Cycle-2 traceability analysis of the corrected configless-install plan (planning.md +
phase-1..5-tasks.md, 25 tasks) against the validated specification, both directions, read
fresh. The cycle-1 finding (a `type`-only config being dropped, defeating the spec's
reserved use of `type`) was resolved and its cascade verified: task 1-1 now retains a
`type`-only config as `{agents:[], type}`, and tasks 2-1/2-2/3-5 pin
`configType: config?.type` at the unified `detectType` call. No remaining or
newly-introduced traceability gaps were found.

### Direction 1: Specification → Plan (completeness)

Every spec section has plan coverage with adequate depth:

- **Overview / anchor cases** — `refero_skill` (bare `SKILL.md`, no config, untagged) is
  the headline path through tasks 1-2, 2-1, 4-1, 5-2/5-3; `agentic-workflows` (Claude-only
  multi-asset plugin, `configType: undefined` → structural plugin) preserved across 1-2,
  2-1, 1-5.
- **Config Model** — lenient reading (1-1), `{agents, type?}` shape, presence-never-signals-type
  (1-2, 2-1), unknown-key tolerance (1-1), recognised-`type`/leniency boundary (1-1 raw
  pass-through + 1-4 recognition gate). The cycle-1 fix correctly resolved the spec's internal
  tension (optional `agents` + reserved `type`) by treating a `type`-only config as usable.
- **Structural Type Detection** — four shapes, single structural path, canonical plugin rule,
  two-level override precedence (`--plugin` > config `type` > structure), skills-only
  resolution, type-vs-structure hard error, selector grammar, selector/`--plugin`
  orthogonality (1-2, 1-3, 1-4, 2-2, 2-3, 3-5, 3-6).
- **Identity & Naming** — dir-basename throughout, no frontmatter parsing, recursive
  keep-everything copy (2-1, 2-3, 4-1/4-2 keying).
- **Manifest Keying & Lifecycle** — `type?` field + optionality, persist resolved type
  (standalone 4-1, members 4-2), replay (skill 4-4, plugin 4-5), derive-before-delete
  predicates, irreconcilable abort intact (4-6), per-entry abort granularity + partial-success
  exit (4-7), in-memory legacy backfill from `files` on read with anti-drift rationale (4-3),
  unchanged keying, member-by-path replay (no root reshape reaches members).
- **Agent Selection** — KNOWN_AGENTS default replacing `return []`, hard ceiling, auto-select
  scoping (declared-single only), three unified no-constraint cases (1-5; per-member 3-2;
  update preserves installed agents via `computeAgentChanges`).
- **Collection Membership & Selection Flow** — structural one-level membership (1-3, 3-1),
  per-child agents (3-2), select-all/selector UX (3-6), nested unsupported with pipeline
  warning (3-4), stray-root config (3-5).
- **Version Pinning** — reuse tagless→HEAD unchanged, no new code (carried as "unchanged"
  in P4 acceptance and 4-3/4-4 context).
- **Copy-Safety Hardening** — path-traversal guard (5-1), symlink-escape guard with clone-root
  boundary + lexical broken-link handling (5-2), pre-flight wiring on add (5-3) and update
  re-copy with clone-root threading (5-4); copy mechanism + post-copy `agntc.json` deletion
  unchanged (the spec's "generalised" claim is satisfied by the existing asymmetric mechanism
  — bare-skill deletes it, plugins/members copy only asset dirs so a root config is naturally
  never copied — which the plan preserves; verified against `src/copy-bare-skill.ts` and
  `src/copy-plugin-assets.ts`).
- **Backward-Compat / Migration** — existing installs via legacy backfill (4-3), `init`
  unchanged (no task needed — correctly omitted), config schema (1-1/1-2), stray root config
  (3-5), collection child-config dependency (3-1).
- **Error & Abort Behaviour** — detection-time hard errors pre-flight non-zero (1-4, 2-2, 3-5,
  5-3), update abort intact (4-6), partial collection outcomes + exit status (4-7), copy-failed
  distinct from abort (4-6).

### Direction 2: Plan → Specification (fidelity)

All plan content traces back to the spec. Spot-checked the higher-risk items:

- The `--plugin > config type` precedence "moot in the skills-only case" framing (1-4) is
  spec-grounded (both inputs push to "plugin"); centralising it is faithful.
- EACCES/non-ENOENT IO propagation and cancel/zero-selection `[]` (1-1, 1-5) are faithful
  preservation of existing behaviour the spec leaves untouched ("config reading is lenient"
  does not extend to swallowing real filesystem failures).
- The cycle-1 retained-`type`-only-config behaviour (1-1) is grounded in *Config Model →
  Config shape* (`agents` optional; `type` reserved for the skills-only bundle) and
  *Structural Type Detection → Skills-only resolution* ("config `type: plugin` bundles it,
  even a single skill") — not an invented capability.
- Per-task scope boundaries, the dead-`ConfigError` removal (3-3), and the
  verification-only nature of 3-5/3-6 are consistent with the spec and with each other.
- Phase 5 update pre-flight running the symlink scan only (no path-traversal on update) is
  spec-faithful: update replays a recorded key, not a fresh source-supplied selector.

### Note (non-finding): cosmetic wording staleness in task 2-1

The cycle-1 cascade updated task 2-1's **Do** step to pin
`detectType(sourceDir, { onWarn, configType: config?.type })`, but left the task's
**Solution** sentence and one acceptance criterion / test phrased as "with options
`{ onWarn }`" / "the options arg has no `hasConfig` key." This is internal wording
staleness, not a traceability defect: the operative assertions (detectType called **once**,
**no `hasConfig`**) remain correct and spec-faithful (the test asserts absence of
`hasConfig`, not exclusivity of `onWarn`), and the spec does not dictate the `detectType`
call shape. No fix is raised — it carries no spec-fidelity or completeness consequence and
is below the threshold for a traceability finding.

## Findings

None. The plan is a faithful, complete bidirectional translation of the specification.
The cycle-1 finding is resolved and its cascade is internally consistent.
