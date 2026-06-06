---
status: in-progress
created: 2026-06-06
cycle: 2
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

Cycle 2 re-reviews the plan after the cycle-1 correction (task 1-1 retains a `type`-only config; tasks 2-1/2-2/3-5 pin `configType: config?.type` at the unified `detectType` call). The cycle-1 fix is correctly applied at the **authoritative implementation instructions**: task 2-1's "Do" second bullet now pins `detectType(sourceDir, { onWarn, configType: config?.type })`, task 2-2's "Do" extends it to `{ onWarn, configType: config?.type, forcePlugin: options?.forcePlugin }`, and task 3-5 is reworded from a conditional edit to a no-op verification of the 2-1-pinned seam. The cross-task contract is now internally consistent across the Do steps, and no new structural/dependency/slicing problems were introduced.

The plan remains structurally excellent and implementation-ready: all 25 tasks across 5 phases follow the canonical task template, are vertically sliced (one TDD cycle each, independently testable), and phase progression (Foundation → standalone install → collections → lifecycle → hardening) plus every cross-task dependency (3-3 after 3-1/3-2; 4-2→4-1; 4-5→4-4; 4-6→4-4/4-5; 4-7→4-6; 5-3→5-1/5-2; 5-4→5-2) is sound with no circular dependencies and no unmet convergence points.

One residual finding: the cycle-1 fix updated task 2-1's "Do" step but left three of task 2-1's recap surfaces (the Solution sentence, one Acceptance Criterion, and one Tests line) still describing the call as `{ onWarn }`. The Acceptance Criterion in particular is a pass/fail verifiable statement that now contradicts the authoritative "Do" step, so this is raised below (not purely cosmetic).

## Findings

### 1. Task 2-1's Solution / one Acceptance Criterion / one Tests line still describe the `detectType` call as `{ onWarn }`, contradicting the cycle-1-pinned `{ onWarn, configType: config?.type }` "Do" step

**Severity**: Important
**Plan Reference**: Phase 2 task configless-install-2-1 — Solution paragraph; the "detectType is called exactly once" Acceptance Criterion; the `"calls detectType once with { onWarn } and no hasConfig"` Tests line
**Category**: Task Template Compliance / Acceptance Criteria Quality (internal consistency between a task's authoritative "Do" step and its recap surfaces)

**Change Type**: update-task

**Details**:
The cycle-1 fix pinned the canonical call shape in task 2-1's "Do" second bullet to `const detected = await detectType(sourceDir, { onWarn, configType: config?.type });`. But three recap surfaces of the same task were not updated and still say the call is made with options `{ onWarn }`:

1. **Solution** (line 13): "run `detectType(sourceDir, { onWarn })` **once**".
2. **Acceptance Criterion** (line 35): "`detectType` is called **exactly once** per standalone run, with options `{ onWarn }` and no `hasConfig` property."
3. **Tests** (line 47): "`"calls detectType once with { onWarn } and no hasConfig"` — assert `mockDetectType` call count is 1 and the options arg has no `hasConfig` key."

The Solution and the Tests *narrative* are recap-only and harmless in isolation, but the **Acceptance Criterion** is a pass/fail verifiable statement. As written, "with options `{ onWarn }`" directly contradicts the pinned "Do" step (`{ onWarn, configType: config?.type }`). An implementer writing the test literally from this criterion would assert the options object equals `{ onWarn }` and the test would fail against the correct implementation — or, worse, they would "fix" the test by reverting the `configType` forwarding the cycle-1 finding deliberately added, re-opening the under-specified seam. This is exactly the consistency the cycle-1 fix set out to close, left half-closed at the recap layer.

The fix is to make all three recap surfaces describe the pinned call shape. The Tests *assertion body* is already correct (it asserts only call-count and absence of `hasConfig`, both still true); only its descriptive framing should stop implying the options are limited to `{ onWarn }`, and the criterion should assert the presence of `configType: config?.type` rather than an exact `{ onWarn }` object. (The `forcePlugin` key is added by task 2-2, so 2-1's criterion should describe the shape *as 2-1 leaves it* — `{ onWarn, configType: config?.type }`, no `forcePlugin`, no `hasConfig`.)

**Current** (phase-2-tasks.md, task configless-install-2-1, Solution — the relevant clause):

> **Solution**: Collapse the `config === null` collection-gate and the separate config-present standalone path into a single flow: clone, read config leniently (`AgntcConfig | null`), run `detectType(sourceDir, { onWarn })` **once** (structure is the sole authority — config presence is not an input), then branch on the *detected type*.

**Proposed** (phase-2-tasks.md, task configless-install-2-1, Solution — the relevant clause):

> **Solution**: Collapse the `config === null` collection-gate and the separate config-present standalone path into a single flow: clone, read config leniently (`AgntcConfig | null`), run `detectType(sourceDir, { onWarn, configType: config?.type })` **once** (structure is the sole authority — config presence is not an input; the root config's optional `type` is forwarded as `configType` so detection alone owns recognition, per the "Do" step), then branch on the *detected type*.

**Current** (phase-2-tasks.md, task configless-install-2-1, Acceptance Criteria — the call-shape criterion):

> - [ ] `detectType` is called **exactly once** per standalone run, with options `{ onWarn }` and no `hasConfig` property.

**Proposed** (phase-2-tasks.md, task configless-install-2-1, Acceptance Criteria — the call-shape criterion):

> - [ ] `detectType` is called **exactly once** per standalone run, with options `{ onWarn, configType: config?.type }` (the cycle-1-pinned canonical shape — `configType` forwarded, `forcePlugin` added later by task 2-2) and **no** `hasConfig` property.

**Current** (phase-2-tasks.md, task configless-install-2-1, Tests — the call-shape test line):

> - `"calls detectType once with { onWarn } and no hasConfig"` — assert `mockDetectType` call count is 1 and the options arg has no `hasConfig` key.

**Proposed** (phase-2-tasks.md, task configless-install-2-1, Tests — the call-shape test line):

> - `"calls detectType once with configType forwarded and no hasConfig"` — assert `mockDetectType` call count is 1, the options arg includes `configType: config?.type`, and it has no `hasConfig` key.

**Resolution**: Pending
**Notes**: The authoritative "Do" second bullet (already pinned in cycle 1) is correct and unchanged by this finding; only task 2-1's Solution sentence, the call-shape Acceptance Criterion, and the call-shape Tests line are brought into agreement with it. The tick task mirroring 2-1 (cycle-1 notes reference tick-e6e0d2) should be updated to match if approved.

---
