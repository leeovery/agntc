---
status: complete
created: 2026-06-07
cycle: 6
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

Cycle 6 re-reviews the plan as a standalone document after five converging cycles. Cycle-6 traceability is clean; this review verifies structural integrity and internal consistency once more. **No genuine structural or consistency defect was found.** The plan is structurally sound, internally consistent, and implementation-ready.

The full plan was read end-to-end: planning.md (5 phases) and all 25 task bodies (phase-1-tasks.md … phase-5-tasks.md), plus the c1–c5 integrity tracking files to avoid re-raising resolved findings.

### Structural quality (clean)

- **Task-template compliance** — all 25 tasks carry Problem, Solution, Outcome, Do, Acceptance Criteria, Tests, plus Edge Cases / Context / Spec Reference. Problem statements explain *why*; Solution statements describe *what*; Outcome statements define the verifiable end state; acceptance criteria are concrete pass/fail; Tests include edge cases (broken symlinks, cycle safety, vanished subdirs, null config, all-unknown agents, etc.), not just happy paths.
- **Vertical slicing** — each task is a single TDD cycle delivering complete, independently verifiable behaviour (lenient config reading, single structural detection path, override resolution, agent default, standalone install, `--plugin` surface, tree-path selector, structural membership, per-member agent resolution, type record/replay/backfill, abort surfacing, partial-success exit, traversal/symlink guards, guard wiring). No horizontal "all models then all services" slicing.
- **Phase structure** — Foundation (detection/config/agent primitives) → standalone install through `add` → structural collections → manifest type lifecycle → copy-safety hardening. Logical progression; each phase has clear acceptance and is independently testable; boundaries are non-arbitrary (the lifecycle phase is a distinct data-migration/non-destructive-validation risk profile; hardening is a distinct security checkpoint).
- **Dependencies & ordering** — every cross-task/cross-phase dependency is explicit, graph-correct, and acyclic: 3-3 after 3-1/3-2 (shared-loop churn); 4-2→4-1 (interface + mapping helper); 4-3 backfill feeding 4-4/4-5; 4-5→4-4 (validate-before-nuke seam + abort variant); 4-6→4-4/4-5 (abort result); 4-7→4-6 (`aborted` outcome); 5-3→5-1/5-2 (guard utilities); 5-4→5-2 (symlink scan) and the clone-root plumbing. Convergence points (4-6 needing both 4-4 and 4-5; 5-3 needing both 5-1 and 5-2) carry explicit edges. Intra-phase sequential tasks rely on natural authoring order where correct; no missing-edge hazard found.
- **Self-containment & scope** — each task pulls the relevant spec decisions into its Context, names concrete file/line anchors, and disclaims out-of-scope adjacent work (e.g. 2-1 disclaims the collection-member not-agntc skip owned by 3-4; 3-3 functionally independent of 3-1/3-2 but ordered after them; 5-3 disclaims 4-7's `runAllUpdates` scope). Granularity is right — no task is mechanical boilerplate, none sprawls across multiple architectural boundaries.

### Internal consistency (clean — the recap-residue class cycles c1–c5 closed stays closed)

- **not-agntc loud non-zero exit** — every `ExitSignal(0)` mention in the plan describes *legacy code being removed* (the `config === null` block, the duplicate standalone collection guard, the `pluginConfigs.size === 0` gate), never the new not-agntc behaviour. Task 2-1's Solution clause (the c4 fix target) reads "loud pre-flight failure (source-named `p.cancel` + `ExitSignal(1)`, not a silent exit)" and is consistent with its own Do/Outcome/Acceptance/Tests/Edge Cases and with task 2-3 and the planning.md Phase 2 acceptance. No exit-0 "clean exit" residue remains.
- **`configType: config?.type` canonical call shape** — pinned consistently across 1-4 (defines `configType?` input + `"plugin"`-only recognition gating), 2-1 (pins `{ onWarn, configType: config?.type }`), 2-2 (adds only `forcePlugin`), and 3-5 (no-op verification of the same seam). No `{ onWarn }`-only call-shape recap residue.
- **`hasConfig` removal** — all `hasConfig` references describe the old option being dropped at the call sites; no surface treats it as a live input.
- **Collection-`add` partial-failure exit (c5 fix)** — present and consistent across task 5-3's authoritative body *and* the plan-level recap surfaces: planning.md Phase 5 acceptance bullet (a `failed` member commits siblings, renders the summary, then `ExitSignal(1)`; `skipped` non-fatal) and the 5-3 task-table Edge Cases cell both reflect it, in parity with task 4-7's analogous `update` partial-success exit.
- **Phase 4/5 abort & failure-mapping seams** — the `NukeReinstallAborted` `{ status: "aborted"; recordedType; reason }` result, its threading through `clone-reinstall.ts` to a dedicated `aborted` failure reason (never conflated with `copy-failed`), the explicit "must not route through `handleCopyFailedRemoval`" guard, and the install-intact / non-zero / named contract are stated consistently in 4-4, 4-5, 4-6, 4-7, and reused by 5-4. Task 5-4 offering two mapping options (new `failureReason` vs reuse `aborted`) is bounded by acceptance criteria pinning the observable contract — acceptable implementation latitude, not an ambiguity defect.

### Conclusion

The plan has converged. Across all 25 tasks and 5 phases it meets the integrity standard: template compliance, vertical slicing, sound phase progression, explicit acyclic dependencies, self-contained tasks, concrete pass/fail acceptance criteria, and edge-case-bearing tests. The prior cycles' residual recap-surface findings (c2 `{ onWarn }` call shape, c3 not-agntc exit-0 trio, c4 task 2-1 Solution "clean exit", c5 plan-level 5-3 partial-failure-exit recap) are all confirmed closed. No new structural or consistency defect that would mislead an implementer was identified.

## Findings

None. The plan is structurally sound and internally consistent.
