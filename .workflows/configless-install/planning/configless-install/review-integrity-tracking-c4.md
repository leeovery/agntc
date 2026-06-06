---
status: complete
created: 2026-06-06
cycle: 4
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

Cycle 4 re-reviews the plan as a standalone document after three converging cycles, with focus on the three cumulative fixes the convergence prompt names: (1) type-only config retention (task 1-1), (2) `configType: config?.type` pinning at the unified `detectType` call (tasks 1-4/2-1/2-2/3-5), and (3) the not-agntc loud non-zero pre-flight exit (`ExitSignal(1)`, source-named `p.cancel`) in tasks 2-1/2-3 and the Phase 2 acceptance.

All three fixes are correctly and consistently applied across the **authoritative** surfaces:

- **Type-only config retention** (1-1): the Solution, Outcome, Do steps, Acceptance Criteria, Tests, Edge Cases, and Context all consistently state that a `type`-only config (`{type:"plugin"}`) is retained as `{agents:[], type:"plugin"}` rather than discarded; no surface still describes the old "discard type-only config" behaviour. Downstream consumers (1-4 recognition gating, 2-1 `config?.agents ?? []` wiring) reference this retained `type` correctly.
- **`configType` pinning**: task 1-4 defines `detectType`'s `configType?` input and gates recognition to the exact string `"plugin"`; task 2-1 pins the canonical call `detectType(sourceDir, { onWarn, configType: config?.type })`; task 2-2 extends it to add only `forcePlugin`; task 3-5 is a no-op verification of the same seam. The Solution, the call-shape Acceptance Criterion, and the call-shape Tests line in 2-1 (the cycle-1/cycle-2 fix targets) all describe `{ onWarn, configType: config?.type }`. No residual `{ onWarn }`-only call-shape recap remains.
- **not-agntc loud exit**: every `ExitSignal(0)` reference remaining in the plan (phase-2-tasks.md lines 18, 26; phase-3-tasks.md lines 20, 37) describes **legacy code being removed** (the old `config === null` block, the duplicate standalone collection guard, the `pluginConfigs.size === 0` gate) — correctly not the new not-agntc behaviour. Task 2-1's Outcome, Do branch, Acceptance Criterion, Tests, and Edge Cases, task 2-3's Outcome, Do, Acceptance Criterion, Tests, and Edge Cases, and the planning.md Phase 2 acceptance + the two Edge Cases task-table cells (the cycle-3 fix targets) all state `ExitSignal(1)` / loud source-named `p.cancel`.

The collection-**member** not-agntc skip (task 3-4: warned, siblings continue, no hard exit) remains correctly carved out from the loud standalone failure, with task 2-1's Do explicitly disclaiming ownership of it. No collision between the two was introduced.

The plan remains structurally excellent and implementation-ready across all 25 tasks / 5 phases: canonical task-template compliance throughout, vertical slicing (one TDD cycle each, independently testable), sound Foundation → standalone install → collections → lifecycle → hardening progression, and every cross-task dependency (3-3 after 3-1/3-2; 4-2→4-1; 4-3 backfill feeding 4-4/4-5; 4-5→4-4; 4-6→4-4/4-5; 4-7→4-6; 5-3→5-1/5-2; 5-4→5-2) is explicit, graph-correct, and free of cycles or unmet convergence points.

One residual finding: the cycle-3 not-agntc fix updated task 2-1's Outcome/Do/Acceptance/Tests/Edge Cases and task 2-3's Solution + the planning edge-case cells, but left **task 2-1's Solution clause** still describing the not-agntc path as a "clean exit" — the one surface of that fix not propagated. It is a same-task contradiction (the Solution contradicts 2-1's own authoritative "Do" step and four other surfaces of the same task), of exactly the recap-residue class that cycles 2 and 3 each closed for an adjacent surface.

## Findings

### 1. Task 2-1's Solution still describes the not-agntc path as "clean exit", contradicting the same task's cycle-3-pinned `ExitSignal(1)` "Do" step and four other surfaces

**Severity**: Important
**Plan Reference**: phase-2-tasks.md task configless-install-2-1 — Solution paragraph (the `` `not-agntc` → clean exit `` clause)
**Category**: Internal consistency / Acceptance Criteria Quality (a task's recap Solution contradicting its own authoritative "Do" step, Outcome, Acceptance Criterion, Tests, and Edge Cases)
**Change Type**: update-task

**Details**:
The cycle-3 traceability/integrity fix reclassified a standalone not-agntc source from a silent exit-0 to a loud non-zero pre-flight failure (`ExitSignal(1)`, source-named `p.cancel`) and applied it to every authoritative surface of task 2-1 — the "Do" not-agntc branch (line 22: `throw new ExitSignal(1)` … "a **loud non-zero pre-flight failure**"), the Outcome (line 15: "exits **non-zero** (`ExitSignal(1)`)"), the call-out Acceptance Criterion (line 34: "exits **non-zero** (`ExitSignal(1)`)"), the two Tests lines (lines 45–46: "exits non-zero"), and the Edge Cases (line 56: "**non-zero** exit (`ExitSignal(1)`)") — and to task 2-3 and the planning.md Phase 2 acceptance and edge-case cells.

One surface of task 2-1 was missed: the **Solution** paragraph (line 13) still reads `` `not-agntc` → clean exit. ``. "Clean exit" is the language of the *removed* silent exit-0 behaviour. This directly contradicts the same task's own authoritative "Do" step (line 22) and its Outcome, Acceptance Criterion, Tests, and Edge Cases — all of which state the loud `ExitSignal(1)` pre-flight failure. The Solution is the high-level framing an implementer reads first; "clean exit" mischaracterises the not-agntc branch as a benign no-op exactly as the pre-fix code did. An implementer skimming the Solution for the branch table could carry "not-agntc → clean exit" into the implementation, reintroducing the silent exit-0 the cycle-3 fix deliberately removed — then find it contradicted five times elsewhere in the same task. This is an internally inconsistent task and the same recap-residue pattern cycles 2 and 3 each closed (cycle 2: the `{ onWarn }` call-shape recap; cycle 3: task 2-3's "Do" + the two planning edge-case cells).

The fix is to restate the Solution's not-agntc clause as the loud non-zero pre-flight failure, matching the authoritative "Do" step and the rest of the task. (The adjacent `collection` and `bare-skill`/`plugin` clauses in the same sentence are correct and unchanged.)

**Current** (phase-2-tasks.md, task configless-install-2-1, Solution — the branch-table sentence):

> **Solution**: Collapse the `config === null` collection-gate and the separate config-present standalone path into a single flow: clone, read config leniently (`AgntcConfig | null`), run `detectType(sourceDir, { onWarn, configType: config?.type })` **once** (structure is the sole authority — config presence is not an input; the root config's optional `type` is forwarded as `configType` so detection alone owns recognition, per the "Do" step), then branch on the *detected type*. `collection` → existing `runCollectionPipeline` dispatch (untouched — Phase 3 owns its rework). `not-agntc` → clean exit. `bare-skill` / `plugin` → the standalone install, sourcing declared agents from `config?.agents ?? []` so a configless unit falls through to the Phase 1 `KNOWN_AGENTS` default inside `selectAgents`. Update both `detectType` call sites in `runAdd` to the Phase 1 options shape and remove the dead `ConfigError` machinery.

**Proposed** (phase-2-tasks.md, task configless-install-2-1, Solution — the branch-table sentence):

> **Solution**: Collapse the `config === null` collection-gate and the separate config-present standalone path into a single flow: clone, read config leniently (`AgntcConfig | null`), run `detectType(sourceDir, { onWarn, configType: config?.type })` **once** (structure is the sole authority — config presence is not an input; the root config's optional `type` is forwarded as `configType` so detection alone owns recognition, per the "Do" step), then branch on the *detected type*. `collection` → existing `runCollectionPipeline` dispatch (untouched — Phase 3 owns its rework). `not-agntc` → loud pre-flight failure: a source-named `p.cancel` and a **non-zero** exit (`ExitSignal(1)`), per spec *Error & Abort Behaviour → Hard errors* (the silent exit-0 clean-exit behaviour is deliberately replaced — see the "Do" step). `bare-skill` / `plugin` → the standalone install, sourcing declared agents from `config?.agents ?? []` so a configless unit falls through to the Phase 1 `KNOWN_AGENTS` default inside `selectAgents`. Update both `detectType` call sites in `runAdd` to the Phase 1 options shape and remove the dead `ConfigError` machinery.

**Resolution**: Fixed
**Notes**: Updated task 2-1's Solution recap clause in phase-2-tasks.md to state the loud non-zero pre-flight failure (source-named `p.cancel` + `ExitSignal(1)`), matching the task's authoritative Do/Outcome/Acceptance/Tests/Edge Cases. A full sweep across all plan files and tick tasks (tick-e6e0d2, tick-f8f897) confirmed no remaining not-agntc exit-0 residue; the tick 2-1 summary does not carry the "clean exit" phrasing, so no tick sync was needed.

---
