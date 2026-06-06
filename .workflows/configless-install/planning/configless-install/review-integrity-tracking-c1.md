---
status: complete
created: 2026-06-06
cycle: 1
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

The plan is structurally excellent and implementation-ready. All 25 tasks across 5 phases follow the canonical task template (Problem / Solution / Outcome / Do / Acceptance Criteria / Tests / Edge Cases / Context / Spec Reference), with concrete file paths, line-number anchors, named functions, and pull-forward spec context. Tasks are vertically sliced (each a single TDD cycle with an independently writable test), phases follow a sound Foundation → Standalone install → Collections → Lifecycle → Hardening progression, and cross-task contracts (the `detectType` options-shape evolution, `TypeConflictError` identity-prefixing seam, the `ManifestEntry.type` mapping, the `bare-skill → "skill"` seam, the abort-result threading through `clone-reinstall.ts`, the copy-safety guard signatures, the `configType: config?.type` forwarding seam) are internally consistent and verified against the real source (`src/nuke-reinstall-pipeline.ts`, `src/clone-reinstall.ts`, `src/summary.ts`, `src/commands/add.ts`).

Dependency/ordering is sound: intra-phase tasks are in natural internal-ID order and every cross-task dependency (e.g. 3-3 "land after 3-1/3-2", 4-2 depends on 4-1, 4-5 depends on 4-4, 4-6 depends on 4-4/4-5, 4-7 depends on 4-6, 5-3 depends on 5-1/5-2, 5-4 depends on 5-2) is stated explicitly in prose with the genuine data/capability reason. No circular dependencies. No convergence point lacks its predecessors. Per the natural-ordering convention, no explicit dependency edges are required.

One minor consistency finding follows.

## Findings

### 1. Task 2-1's stated single `detectType` call omits `configType`, which task 3-5 then conditionally back-fills — leaving the canonical Phase 2 call shape under-specified

**Severity**: Minor
**Plan Reference**: Phase 2 task configless-install-2-1 (the single `detectType` call); cross-references Phase 2 task 2-2 and Phase 3 task 3-5
**Category**: Internal consistency across tasks (cross-task contract reference)
**Change Type**: update-task

**Details**:
Task 2-1 specifies the unified detection call as `const detected = await detectType(sourceDir, { onWarn });` (phase-2-tasks.md line 19) — forwarding neither `forcePlugin` nor `configType`. Task 2-2 subsequently adds `forcePlugin`. Task 3-5 then says: "**If task 2-1's wiring did not already forward `configType: config?.type`, add it here**" and notes the final call should be `detectType(unitDir, { onWarn, forcePlugin: options?.forcePlugin, configType: config?.type })`.

This is functionally safe (the `configType` seam is only load-bearing for the root-`type:"plugin"`-on-a-collection hard error, which task 3-5 owns and tests), and every dependent task names the seam explicitly, so an implementer will not be stranded. But the canonical Phase 2 call shape is left ambiguous across three tasks: 2-1 omits `configType`, 2-2 adds only `forcePlugin`, and whether 3-5 is a no-op verification or a real edit is left conditional on what 2-1/2-2 happened to do. Because `readConfig` (task 1-1) already returns the optional `type` and `detectType` (task 1-4) already accepts `configType`, the cleanest single source of truth is to forward `configType: config?.type` at the moment 2-1 establishes the unified call — making 2-2 a pure `forcePlugin` addition and 3-5 a genuine no-op verification of an existing seam rather than a conditional edit. This removes the "if it wasn't already done, do it" branch in 3-5 and pins the call shape once.

This is a polish/clarity improvement, not a correctness gap — the plan as written will produce the correct behaviour either way because 3-5 closes the seam unconditionally.

**Current** (phase-2-tasks.md, task configless-install-2-1, "Do" — second bullet, the unified call):

> - **Replace** the step-5 standalone `detectType(sourceDir, { hasConfig: true, onWarn })` (lines ~198–202) with a single call **before** any type branch: `const detected = await detectType(sourceDir, { onWarn });` (Phase 1 dropped `hasConfig`; do not pass it). This one call serves every type.

**Proposed** (phase-2-tasks.md, task configless-install-2-1, "Do" — second bullet, the unified call):

> - **Replace** the step-5 standalone `detectType(sourceDir, { hasConfig: true, onWarn })` (lines ~198–202) with a single call **before** any type branch: `const detected = await detectType(sourceDir, { onWarn, configType: config?.type });` (Phase 1 dropped `hasConfig`; do not pass it). This one call serves every type. Forward the root config's optional `type` as `configType` now — `readConfig` (task 1-1) already surfaces it and `detectType` (task 1-4) already consumes it; recognition (`"plugin"` vs. ignored) is centralised in detection. This pins the canonical call shape: task 2-2 adds only `forcePlugin`, and task 3-5's `configType` forwarding becomes a no-op verification of an already-established seam rather than a conditional edit. (A root config with no `type` passes `configType: undefined` → structure stands.)

**Resolution**: Fixed
**Notes**: Applied to phase-2-tasks.md (task 2-1 unified call now pins `configType: config?.type`; task 2-2 call now `{ onWarn, configType: config?.type, forcePlugin: options?.forcePlugin }`) and phase-3-tasks.md (task 3-5's "Note on detectType config-type input" and "Do" first bullet reworded from conditional "if not already added, add it" to a no-op verification of the 2-1-pinned seam). Corresponding tick tasks tick-e6e0d2 (2-1), tick-144941 (2-2), tick-21a300 (3-5) updated to match.

---
